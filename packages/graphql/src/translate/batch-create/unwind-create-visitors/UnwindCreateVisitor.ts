/*
 * Copyright (c) "Neo4j"
 * Neo4j Sweden AB [http://neo4j.com]
 *
 * This file is part of Neo4j.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { Context } from "../../../types";
import type { CallbackBucket } from "../../../classes/CallbackBucket";
import type { Visitor, ICreateAST, INestedCreateAST } from "../GraphQLInputAST/GraphQLInputAST";
import type { Node, Relationship } from "../../../classes";
import createRelationshipValidationString from "../../create-relationship-validation-string";
import { filterTruthy } from "../../../utils/utils";
import { Neo4jGraphQLError } from "../../../classes";
import Cypher, { Expr, Map, MapProjection } from "@neo4j/cypher-builder";
import mapToDbProperty from "../../../utils/map-to-db-property";

type UnwindCreateScopeDefinition = {
    unwindVar: Cypher.Variable;
    parentVar: Cypher.Variable;
    clause?: Cypher.Clause;
}
type GraphQLInputASTNodeRef = string;
type UnwindCreateEnvironment = Record<GraphQLInputASTNodeRef, UnwindCreateScopeDefinition>

export class UnwindCreateVisitor implements Visitor {
    unwindVar: Cypher.Variable;
    callbackBucket: CallbackBucket;
    context: Context;
    rootNode: Cypher.Node | undefined;
    clause: Cypher.Clause | undefined;
    environment: UnwindCreateEnvironment;
    

    constructor(
        unwindVar: Cypher.Variable,
        callbackBucket: CallbackBucket,
        context: Context,
    ) {
        this.unwindVar = unwindVar;
        this.callbackBucket = callbackBucket;
        this.context = context;
        this.environment = {};
    }

    visitCreate(create: ICreateAST): void {
        const labels = create.node.getLabels(this.context);
        const currentNode = new Cypher.Node({
            labels,
        });

        const setProperties = [...create.nodeProperties].map((property: string) =>
            fieldToSetParam(create.node, currentNode, property, this.unwindVar.property(property))
        );
        const autogeneratedProperties = getAutoGeneratedFields(create.node, currentNode);

        const createClause = new Cypher.Create(currentNode).set(...setProperties, ...autogeneratedProperties);

        const relationshipValidationClause = new Cypher.RawCypher((env: Cypher.Environment) => {
            const validationStr = createRelationshipValidationString({
                node: create.node,
                context: this.context,
                varName: env.getReferenceId(currentNode),
            });
            const cypher = [] as string[];

            if (validationStr) {
                cypher.push(`WITH ${env.getReferenceId(currentNode)}`);
                cypher.push(validationStr);
            }
            return cypher.join("\n");
        });
        let nestedClauses;
        if (create.children) {
            const childrenRefs = create.children.map((children) => {
                this.environment[children.id] = { unwindVar: this.unwindVar, parentVar: currentNode };
                children.accept(this);
                return children.id;
            });
            nestedClauses = childrenRefs.map((childrenRef) => this.environment[childrenRef].clause);
        }
        this.rootNode = currentNode;
        const clause = Cypher.concat(
            ...filterTruthy([
                createClause,
                ...nestedClauses,
                relationshipValidationClause,
                new Cypher.Return(currentNode),
            ])
        );
        this.clause = new Cypher.Call(clause).innerWith(this.unwindVar);
    }

    visitNestedCreate(nestedCreate: INestedCreateAST): void {
        const parentVar = this.environment[nestedCreate.id].parentVar;
        const unwindVar = this.environment[nestedCreate.id].unwindVar;
        if (!parentVar) throw new Neo4jGraphQLError("Generic Error");
        const { node, relationship, relationshipPropertyPath } = nestedCreate;
        const blockWith = new Cypher.With(parentVar, unwindVar);
        const createUnwindVar = new Cypher.Variable();
        const createUnwindClause = new Cypher.Unwind([
            unwindVar.property(relationshipPropertyPath).property("create"),
            createUnwindVar,
        ]);
        const labels = node.getLabels(this.context);
        const currentNode = new Cypher.Node({
            labels,
        });
        const nodeVar = new Cypher.Variable();
        const edgeVar = new Cypher.Variable();
        const withCreate = new Cypher.With(
            [createUnwindVar.property("node"), nodeVar],
            [createUnwindVar.property("edge"), edgeVar],
            parentVar
        );
        const createClause = new Cypher.Create(currentNode);
        if (!relationship[0]) {
            throw new Neo4jGraphQLError("Nested created nodes should belong to a parent");
        }

        const relationshipClause = new Cypher.Relationship({
            source: currentNode,
            target: parentVar as Cypher.Node,
            type: relationship[0].type,
        });

        if (relationship[0].direction === "OUT") {
            relationshipClause.reverse();
        }

        const mergeClause = new Cypher.Merge(relationshipClause);

        const setPropertiesNode = nestedCreate.nodeProperties.map((property: string) =>
            fieldToSetParam(node, currentNode, property, nodeVar.property(property))
        );
        const autogeneratedProperties = getAutoGeneratedFields(node, currentNode);

        createClause.set(...setPropertiesNode, ...autogeneratedProperties);
        if (nestedCreate.edgeProperties && nestedCreate.edgeProperties.length && nestedCreate.edge) {
            const setPropertiesEdge = nestedCreate.edgeProperties.map((property) => {
                return fieldToSetParam(
                    nestedCreate.edge as Relationship,
                    relationshipClause,
                    property,
                    edgeVar.property(property)
                );
            });
            const autogeneratedEdgeProperties = getAutoGeneratedFields(nestedCreate.edge, relationshipClause);
            mergeClause.set(...setPropertiesEdge, ...autogeneratedEdgeProperties);
        }

        const subQueryStatements = [blockWith, createUnwindClause, withCreate, createClause, mergeClause] as (
            | undefined
            | Cypher.Clause
        )[];
        const relationshipValidationClause = new Cypher.RawCypher((env: Cypher.Environment) => {
            const validationStr = createRelationshipValidationString({
                node,
                context: this.context,
                varName: env.getReferenceId(currentNode),
            });
            const cypher = [] as string[];
            if (validationStr) {
                cypher.push(`WITH ${env.getReferenceId(currentNode)}`);
                cypher.push(validationStr);
            }
            return cypher.join("\n");
        });

        let nestedClauses;

        if (nestedCreate.children) {
            const childrenRefs = nestedCreate.children.map((children) => {
                this.environment[children.id] = { unwindVar: nodeVar, parentVar: currentNode };
                children.accept(this);
                return children.id;
            });
            nestedClauses = childrenRefs.map((childrenRef) => this.environment[childrenRef].clause);
            subQueryStatements.push(...nestedClauses);
        }
        subQueryStatements.push(relationshipValidationClause);
        subQueryStatements.push(new Cypher.Return(Cypher.collect(new Cypher.Literal(null))));
        const subQuery = Cypher.concat(...subQueryStatements);
        const callClause = new Cypher.Call(subQuery);
        const outsideWith = new Cypher.With(parentVar, unwindVar);
        this.environment[nestedCreate.id].clause = Cypher.concat(outsideWith, callClause);
    }

    /*
     * Returns the Cypher Reference of the root Nodes and the Cypher Clause generated
     */
    build(): [Cypher.Node?, Cypher.Clause?] {
        return [this.rootNode, this.clause];
    }
}

function getAutoGeneratedFields(
    graphQLElement: Node | Relationship,
    cypherNodeRef: Cypher.Node | Cypher.Relationship
): Cypher.SetParam[] {
    const setParams: Cypher.SetParam[] = [];
    const timestampedFields = graphQLElement.temporalFields.filter(
        (x) => ["DateTime", "Time"].includes(x.typeMeta.name) && x.timestamps?.includes("CREATE")
    );
    timestampedFields.forEach((field) => {
        // DateTime -> datetime(); Time -> time()
        const relatedCypherExpression = Cypher[field.typeMeta.name.toLowerCase()]() as Cypher.Expr;
        setParams.push([
            cypherNodeRef.property(field.dbPropertyName as string),
            relatedCypherExpression,
        ] as Cypher.SetParam);
    });

    const autogeneratedIdFields = graphQLElement.primitiveFields.filter((x) => x.autogenerate);
    autogeneratedIdFields.forEach((field) => {
        setParams.push([
            cypherNodeRef.property(field.dbPropertyName as string),
            Cypher.randomUUID(),
        ] as Cypher.SetParam);
    });
    return setParams;
}

function fieldToSetParam(
    graphQLElement: Node | Relationship,
    cypherNodeRef: Cypher.Node | Cypher.Relationship,
    key: string,
    value: Exclude<Expr, Map | MapProjection>
): Cypher.SetParam {
    const pointField = graphQLElement.pointFields.find((x) => key === x.fieldName);
    const dbName = mapToDbProperty(graphQLElement, key);
    if (pointField) {
        if (pointField.typeMeta.array) {
            const comprehensionVar = new Cypher.Variable();
            const mapPoint = Cypher.point(comprehensionVar);
            const expression = new Cypher.ListComprehension(comprehensionVar, value).map(mapPoint);
            return [cypherNodeRef.property(dbName), expression];
        }
        return [cypherNodeRef.property(dbName), Cypher.point(value)];
    }
    return [cypherNodeRef.property(dbName), value];
}
