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

import pluralize from "pluralize";
import { Driver, Session } from "neo4j-driver";
import { gql } from "apollo-server";
import { graphql, DocumentNode } from "graphql";
import neo4j from "../neo4j";
import { Neo4jGraphQL } from "../../../src";
import { generateUniqueType } from "../../../tests/utils/graphql-types";
import { getQuerySource } from "../../utils/get-query-source";

describe("connectorcreate with @id", () => {
    let driver: Driver;
    let session: Session;
    let typeDefs: DocumentNode;

    const typeMovie = generateUniqueType("Movie");
    const typeActor = generateUniqueType("Actor");

    let neoSchema: Neo4jGraphQL;

    beforeAll(async () => {
        driver = await neo4j();

        typeDefs = gql`
        type ${typeMovie.name} {
            title: String!
            id: ID! @id
            actors: [${typeActor.name}] @relationship(type: "ACTED_IN", direction: IN)
        }

        type ${typeActor.name} {
            name: String
            movies: [${typeMovie.name}] @relationship(type: "ACTED_IN", direction: OUT)
        }
        `;

        neoSchema = new Neo4jGraphQL({ typeDefs });
    });

    beforeEach(() => {
        session = driver.session();
    });

    afterEach(async () => {
        await session.close();
    });

    afterAll(async () => {
        await driver.close();
    });

    test("create -> connectOrCreate with @id", async () => {
        const query = gql`
            mutation {
              create${pluralize(typeActor.name)}(
                input: [
                  {
                    name: "Tom Hanks"
                    movies: {
                      connectOrCreate: {
                        where: { node: { id: "myid" } }
                        onCreate: { node: { title: "The Terminal" } }
                      }
                    }
                  }
                ]
              ) {
                ${typeActor.plural} {
                  name,
                  movies {
                      id,
                      title
                  }
                }
              }
            }
            `;

        const gqlResult = await graphql({
            schema: neoSchema.schema,
            source: getQuerySource(query),
            contextValue: { driver, driverConfig: { bookmarks: [session.lastBookmark()] } },
        });

        expect(gqlResult.errors).toBeUndefined();
        expect((gqlResult as any).data[`create${pluralize(typeActor.name)}`][typeActor.plural]).toEqual([
            {
                name: "Tom Hanks",
                movies: [{ id: "myid", title: "The Terminal" }],
            },
        ]);

        const movieTitleAndId = await session.run(`
          MATCH (m:${typeMovie.name} {id: "myid"})
          RETURN m.title as title, m.id as id
        `);

        expect(movieTitleAndId.records).toHaveLength(1);
        expect(movieTitleAndId.records[0].toObject().title).toEqual("The Terminal");
    });
});