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

import Cypher from "@neo4j/cypher-builder";
import type { Node, Relationship } from "../classes";
import { AGGREGATION_AGGREGATE_COUNT_OPERATORS, NODE_OR_EDGE_KEYS } from "../constants";
import type { GraphQLWhereArg, PredicateReturn, RelationField } from "../types";
import type { Neo4jGraphQLTranslationContext } from "../types/neo4j-graphql-translation-context";
import { getCypherRelationshipDirection } from "../utils/get-relationship-direction";
import mapToDbProperty from "../utils/map-to-db-property";
import { asArray } from "../utils/utils";
import { getLogicalPredicate, isLogicalOperator } from "./utils/logical-operators";
import {
    createBaseOperation,
    createComparisonOperation,
} from "./where/property-operations/create-comparison-operation";
import type { AggregationFieldRegexGroups } from "./where/utils";
import { aggregationFieldRegEx, whereRegEx } from "./where/utils";

type WhereFilter = Record<string, any>;

export type AggregateWhereInput = {
    count: number;
    count_LT: number;
    count_LTE: number;
    count_GT: number;
    count_GTE: number;
    node: WhereFilter;
    edge: WhereFilter;
} & WhereFilter;

export function aggregatePreComputedWhereFields({
    value,
    relationField,
    relationship,
    context,
    matchNode,
}: {
    value: GraphQLWhereArg;
    relationField: RelationField;
    relationship: Relationship | undefined;
    context: Neo4jGraphQLTranslationContext;
    matchNode: Cypher.Variable;
}): PredicateReturn {
    const refNode = context.nodes.find((x) => x.name === relationField.typeMeta.name) as Node;
    const direction = getCypherRelationshipDirection(relationField);
    const aggregationTarget = new Cypher.Node({ labels: refNode.getLabels(context) });

    const cypherRelation = new Cypher.Relationship({
        type: relationField.type,
    });

    const matchPattern = new Cypher.Pattern(matchNode as Cypher.Node)
        .withoutLabels()
        .related(cypherRelation)
        .withDirection(direction)
        .to(aggregationTarget);

    const matchQuery = new Cypher.Match(matchPattern);
    const innerPredicate = aggregateWhere(
        value as AggregateWhereInput,
        refNode,
        relationship,
        aggregationTarget,
        cypherRelation
    );

    const predicateVariable = new Cypher.Variable();
    matchQuery.return([innerPredicate, predicateVariable]);

    const subquery = new Cypher.Call(matchQuery).innerWith(matchNode);

    return {
        predicate: Cypher.eq(predicateVariable, new Cypher.Literal(true)),
        // Cypher.concat is used because this is passed to createWherePredicate which expects a Cypher.CompositeClause
        preComputedSubqueries: Cypher.concat(subquery),
    };
}

function aggregateWhere(
    aggregateWhereInput: AggregateWhereInput,
    refNode: Node,
    relationship: Relationship | undefined,
    aggregationTarget: Cypher.Node,
    cypherRelation: Cypher.Relationship
): Cypher.Predicate {
    const innerPredicatesRes: Cypher.Predicate[] = [];
    Object.entries(aggregateWhereInput).forEach(([key, value]) => {
        if (AGGREGATION_AGGREGATE_COUNT_OPERATORS.includes(key)) {
            const innerPredicate = createCountPredicateAndProjection(aggregationTarget, key, value);
            innerPredicatesRes.push(innerPredicate);
        } else if (NODE_OR_EDGE_KEYS.includes(key)) {
            const target = key === "edge" ? cypherRelation : aggregationTarget;
            const refNodeOrRelation = key === "edge" ? relationship : refNode;
            if (!refNodeOrRelation) throw new Error(`Edge filter ${key} on undefined relationship`);

            const innerPredicate = aggregateEntityWhere(value, refNodeOrRelation, target);

            innerPredicatesRes.push(innerPredicate);
        } else if (isLogicalOperator(key)) {
            const logicalPredicates: Cypher.Predicate[] = [];
            asArray(value).forEach((whereInput) => {
                const innerPredicate = aggregateWhere(
                    whereInput,
                    refNode,
                    relationship,
                    aggregationTarget,
                    cypherRelation
                );
                logicalPredicates.push(innerPredicate);
            });
            const logicalPredicate = getLogicalPredicate(key, logicalPredicates);
            if (logicalPredicate) {
                innerPredicatesRes.push(logicalPredicate);
            }
        }
    });

    return Cypher.and(...innerPredicatesRes);
}

function createCountPredicateAndProjection(
    aggregationTarget: Cypher.Node,
    filterKey: string,
    filterValue: number
): Cypher.Predicate {
    const paramName = new Cypher.Param(filterValue);
    const count = Cypher.count(aggregationTarget);
    const operator = whereRegEx.exec(filterKey)?.groups?.operator || "EQ";
    const operation = createBaseOperation({
        operator,
        target: count,
        value: paramName,
    });

    return operation;
}

function aggregateEntityWhere(
    aggregateEntityWhereInput: WhereFilter,
    refNodeOrRelation: Node | Relationship,
    target: Cypher.Node | Cypher.Relationship
): Cypher.Predicate {
    const innerPredicatesRes: Cypher.Predicate[] = [];
    Object.entries(aggregateEntityWhereInput).forEach(([key, value]) => {
        if (isLogicalOperator(key)) {
            const logicalPredicates: Cypher.Predicate[] = [];
            asArray(value).forEach((whereInput) => {
                const innerPredicate = aggregateEntityWhere(whereInput, refNodeOrRelation, target);
                logicalPredicates.push(innerPredicate);
            });
            const logicalPredicate = getLogicalPredicate(key, logicalPredicates);
            if (logicalPredicate) {
                innerPredicatesRes.push(logicalPredicate);
            }
        } else {
            const operation = createEntityOperation(refNodeOrRelation, target, key, value);
            innerPredicatesRes.push(operation);
        }
    });
    return Cypher.and(...innerPredicatesRes);
}

function createEntityOperation(
    refNodeOrRelation: Node | Relationship,
    target: Cypher.Node | Cypher.Relationship,
    aggregationInputField: string,
    aggregationInputValue: any
): Cypher.Predicate {
    const paramName = new Cypher.Param(aggregationInputValue);
    const regexResult = aggregationFieldRegEx.exec(aggregationInputField)?.groups as AggregationFieldRegexGroups;
    const { logicalOperator } = regexResult;
    const { fieldName, aggregationOperator } = regexResult;
    const fieldType = refNodeOrRelation?.primitiveFields.find((name) => name.fieldName === fieldName)?.typeMeta.name;

    if (fieldType === "String" && aggregationOperator) {
        return createBaseOperation({
            operator: logicalOperator || "EQ",
            target: getAggregateOperation(Cypher.size(target.property(fieldName)), aggregationOperator),
            value: paramName,
        });
    } else if (aggregationOperator) {
        return createBaseOperation({
            operator: logicalOperator || "EQ",
            target: getAggregateOperation(target.property(fieldName), aggregationOperator),
            value: paramName,
        });
    } else {
        const innerVar = new Cypher.Variable();

        const pointField = refNodeOrRelation.pointFields.find((x) => x.fieldName === fieldName);
        const durationField = refNodeOrRelation.primitiveFields.find(
            (x) => x.fieldName === fieldName && x.typeMeta.name === "Duration"
        );

        const innerOperation = createComparisonOperation({
            operator: logicalOperator || "EQ",
            propertyRefOrCoalesce: innerVar,
            param: paramName,
            durationField,
            pointField,
        });
        const dbFieldName = mapToDbProperty(refNodeOrRelation, fieldName);
        const collectedProperty =
            fieldType === "String" && logicalOperator !== "EQUAL"
                ? Cypher.collect(Cypher.size(target.property(dbFieldName)))
                : Cypher.collect(target.property(dbFieldName));
        return Cypher.any(innerVar, collectedProperty, innerOperation);
    }
}

function getAggregateOperation(
    property: Cypher.Property | Cypher.Function,
    aggregationOperator: string
): Cypher.Function {
    switch (aggregationOperator) {
        case "AVERAGE":
            return Cypher.avg(property);
        case "MIN":
        case "SHORTEST":
            return Cypher.min(property);
        case "MAX":
        case "LONGEST":
            return Cypher.max(property);
        case "SUM":
            return Cypher.sum(property);
        default:
            throw new Error(`Invalid operator ${aggregationOperator}`);
    }
}
