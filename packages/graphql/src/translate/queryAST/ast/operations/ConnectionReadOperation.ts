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

import { createNodeFromEntity } from "../../utils/create-node-from-entity";
import type { Field } from "../fields/Field";
import type { Filter } from "../filters/Filter";
import Cypher from "@neo4j/cypher-builder";
import type { OperationTranspileOptions, OperationTranspileResult } from "./operations";
import { Operation } from "./operations";
import type { Pagination, PaginationField } from "../pagination/Pagination";
import type { Sort, SortField } from "../sort/Sort";
import type { QueryASTContext } from "../QueryASTContext";
import type { RelationshipAdapter } from "../../../../schema-model/relationship/model-adapters/RelationshipAdapter";
import type { ConcreteEntityAdapter } from "../../../../schema-model/entity/model-adapters/ConcreteEntityAdapter";
import type { AuthorizationFilters } from "../filters/authorization-filters/AuthorizationFilters";
import { filterTruthy } from "../../../../utils/utils";
import type { QueryASTNode } from "../QueryASTNode";

export class ConnectionReadOperation extends Operation {
    public readonly relationship: RelationshipAdapter;
    public readonly target: ConcreteEntityAdapter;

    protected directed: boolean;
    public nodeFields: Field[] = [];
    public edgeFields: Field[] = []; // TODO: merge with attachedTo?
    protected filters: Filter[] = [];
    protected pagination: Pagination | undefined;
    protected sortFields: Array<{ node: Sort[]; edge: Sort[] }> = [];
    protected authFilters: AuthorizationFilters[] = [];

    constructor({
        relationship,
        directed,
        target,
    }: {
        relationship: RelationshipAdapter;
        target: ConcreteEntityAdapter;
        directed: boolean;
    }) {
        super();
        this.relationship = relationship;
        this.directed = directed;
        this.target = target;
    }

    public setNodeFields(fields: Field[]) {
        this.nodeFields = fields;
    }

    public setFilters(filters: Filter[]) {
        this.filters = filters;
    }

    public setEdgeFields(fields: Field[]) {
        this.edgeFields = fields;
    }

    public addAuthFilters(...filter: AuthorizationFilters[]) {
        this.authFilters.push(...filter);
    }

    protected getAuthFilterSubqueries(context: QueryASTContext): Cypher.Clause[] {
        return this.authFilters.flatMap((f) => f.getSubqueries(context));
    }

    protected getAuthFilterPredicate(context: QueryASTContext): Cypher.Predicate[] {
        return filterTruthy(this.authFilters.map((f) => f.getPredicate(context)));
    }

    public addSort(sortElement: { node: Sort[]; edge: Sort[] }): void {
        this.sortFields.push(sortElement);
    }

    public addPagination(pagination: Pagination): void {
        this.pagination = pagination;
    }

    public getChildren(): QueryASTNode[] {
        const sortFields = this.sortFields.flatMap((s) => {
            return [...s.edge, ...s.node];
        });

        return filterTruthy([
            ...this.nodeFields,
            ...this.edgeFields,
            ...this.filters,
            ...this.authFilters,
            this.pagination,
            ...sortFields,
        ]);
    }

    protected getSelectionClauses(
        context: QueryASTContext,
        node: Cypher.Node | Cypher.Pattern
    ): {
        preSelection: Array<Cypher.Match | Cypher.With>;
        selectionClause: Cypher.Match | Cypher.With;
    } {
        let matchClause: Cypher.Match | Cypher.With = new Cypher.Match(node);

        let extraMatches = this.getChildren().flatMap((f) => {
            return f.getSelection(context);
        });

        if (extraMatches.length > 0) {
            extraMatches = [matchClause, ...extraMatches];
            matchClause = new Cypher.With("*");
        }

        return {
            preSelection: extraMatches,
            selectionClause: matchClause,
        };
    }

    public transpile({ context, returnVariable }: OperationTranspileOptions): OperationTranspileResult {
        if (!context.target) throw new Error();
        const node = createNodeFromEntity(this.target, context.neo4jGraphQLContext);
        const relationship = new Cypher.Relationship({ type: this.relationship.type });
        const relDirection = this.relationship.getCypherDirection(this.directed);

        const pattern = new Cypher.Pattern(context.target)
            .withoutLabels()
            .related(relationship)
            .withDirection(relDirection)
            .to(node);

        const nestedContext = context.push({ target: node, relationship });

        const { preSelection, selectionClause: clause } = this.getSelectionClauses(nestedContext, pattern);

        const predicates = this.filters.map((f) => f.getPredicate(nestedContext));
        const authPredicate = this.getAuthFilterPredicate(nestedContext);

        const authFilterSubqueries = this.getAuthFilterSubqueries(nestedContext);

        const filters = Cypher.and(...predicates, ...authPredicate);

        const nodeProjectionSubqueries = this.nodeFields
            .flatMap((f) => f.getSubqueries(nestedContext))
            .map((sq) => new Cypher.Call(sq).innerWith(node));

        const nodeProjectionMap = new Cypher.Map();
        this.nodeFields
            .map((f) => f.getProjectionField(node))
            .forEach((p) => {
                if (typeof p === "string") {
                    nodeProjectionMap.set(p, node.property(p));
                } else {
                    nodeProjectionMap.set(p);
                }
            });

        if (nodeProjectionMap.size === 0) {
            const targetNodeName = this.target.name;
            nodeProjectionMap.set({
                __resolveType: new Cypher.Literal(targetNodeName),
                __id: Cypher.id(node),
            });
        }

        const edgeVar = new Cypher.NamedVariable("edge");
        const edgesVar = new Cypher.NamedVariable("edges");
        const totalCount = new Cypher.NamedVariable("totalCount");

        const edgeProjectionMap = new Cypher.Map();

        this.edgeFields
            .map((f) => f.getProjectionField(relationship))
            .forEach((p) => {
                if (typeof p === "string") {
                    edgeProjectionMap.set(p, relationship.property(p));
                } else {
                    edgeProjectionMap.set(p);
                }
            });

        edgeProjectionMap.set("node", nodeProjectionMap);

        let withWhere: Cypher.Clause | undefined;
        if (filters) {
            if (authFilterSubqueries.length > 0) {
                // This is to avoid unnecessary With *
                withWhere = new Cypher.With("*").where(filters);
            } else {
                clause.where(filters);
            }
        }

        let sortSubquery: Cypher.With | undefined;
        if (this.pagination || this.sortFields.length > 0) {
            const paginationField = this.pagination && this.pagination.getPagination();

            sortSubquery = this.getPaginationSubquery(nestedContext, edgesVar, paginationField);
            sortSubquery.addColumns(totalCount);
        }

        let extraWithOrder: Cypher.Clause | undefined;
        if (this.sortFields.length > 0) {
            const sortFields = this.getSortFields(nestedContext, node, relationship);

            extraWithOrder = new Cypher.With(relationship, node).orderBy(...sortFields);
        }

        const projectionClauses = new Cypher.With([edgeProjectionMap, edgeVar])
            .with([Cypher.collect(edgeVar), edgesVar])
            .with(edgesVar, [Cypher.size(edgesVar), totalCount]);

        const returnClause = new Cypher.Return([
            new Cypher.Map({
                edges: edgesVar,
                totalCount: totalCount,
            }),
            returnVariable,
        ]);
        const subClause = Cypher.concat(
            ...preSelection,
            clause,
            ...authFilterSubqueries,
            withWhere,
            extraWithOrder,
            ...nodeProjectionSubqueries,
            projectionClauses,
            sortSubquery,
            returnClause
        );

        return {
            clauses: [subClause],
            projectionExpr: returnVariable,
        };
    }

    protected getPaginationSubquery(
        context: QueryASTContext,
        edgesVar: Cypher.Variable,
        paginationField: PaginationField | undefined
    ): Cypher.With {
        const edgeVar = new Cypher.NamedVariable("edge");

        const subquery = new Cypher.Unwind([edgesVar, edgeVar]).with(edgeVar);
        if (this.sortFields.length > 0) {
            const sortFields = this.getSortFields(context, edgeVar.property("node"), edgeVar);
            subquery.orderBy(...sortFields);
        }

        if (paginationField && paginationField.skip) {
            subquery.skip(paginationField.skip);
        }

        if (paginationField && paginationField.limit) {
            subquery.limit(paginationField.limit);
        }

        const returnVar = new Cypher.Variable();
        subquery.return([Cypher.collect(edgeVar), returnVar]);

        return new Cypher.Call(subquery).innerWith(edgesVar).with([returnVar, edgesVar]);
    }

    protected getSortFields(
        context: QueryASTContext,
        nodeVar: Cypher.Variable | Cypher.Property,
        edgeVar: Cypher.Variable | Cypher.Property
    ): SortField[] {
        return this.sortFields.flatMap(({ node, edge }) => {
            const nodeFields = node.flatMap((s) => s.getSortFields(context, nodeVar, false));
            const edgeFields = edge.flatMap((s) => s.getSortFields(context, edgeVar, false));

            return [...nodeFields, ...edgeFields];
        });
    }
}
