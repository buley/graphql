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

import { Neo4jGraphQLAuthJWTPlugin } from "@neo4j/graphql-plugin-auth";
import { gql } from "apollo-server";
import type { DocumentNode } from "graphql";
import { Neo4jGraphQL } from "../../../../../../src";
import { createJwtRequest } from "../../../../../utils/create-jwt-request";
import { formatCypher, translateQuery, formatParams } from "../../../../utils/tck-test-utils";

describe("Cypher Auth Allow", () => {
    const secret = "secret";
    let typeDefs: DocumentNode;
    let neoSchema: Neo4jGraphQL;

    beforeAll(() => {
        typeDefs = gql`
            type Post {
                id: ID
                creator: User! @relationship(type: "HAS_POST", direction: IN)
            }

            type User {
                id: ID
                name: String
                posts: [Post!]! @relationship(type: "HAS_POST", direction: OUT)
            }

            extend type User
                @auth(rules: [{ operations: [CREATE, UPDATE, CONNECT, DISCONNECT], bind: { id: "$jwt.sub" } }])

            extend type Post
                @auth(rules: [{ operations: [CREATE, CONNECT, DISCONNECT], bind: { creator: { id: "$jwt.sub" } } }])
        `;

        neoSchema = new Neo4jGraphQL({
            typeDefs,
            config: { enableRegex: true },
            plugins: {
                auth: new Neo4jGraphQLAuthJWTPlugin({
                    secret,
                }),
            },
        });
    });

    test("Create Node", async () => {
        const query = gql`
            mutation {
                createUsers(input: [{ id: "user-id", name: "bob" }]) {
                    users {
                        id
                    }
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "CALL {
            CREATE (this0:User)
            SET this0.id = $this0_id
            SET this0.name = $this0_name
            WITH this0
            CALL apoc.util.validate(NOT ((this0.id IS NOT NULL AND this0.id = $this0auth_param0)), \\"@neo4j/graphql/FORBIDDEN\\", [0])
            RETURN this0
            }
            RETURN [
            this0 { .id }] AS data"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"this0_id\\": \\"user-id\\",
                \\"this0_name\\": \\"bob\\",
                \\"this0auth_param0\\": \\"id-01\\",
                \\"resolvedCallbacks\\": {}
            }"
        `);
    });

    test("Create Nested Node", async () => {
        const query = gql`
            mutation {
                createUsers(
                    input: [
                        {
                            id: "user-id"
                            name: "bob"
                            posts: {
                                create: [
                                    { node: { id: "post-id-1", creator: { create: { node: { id: "some-user-id" } } } } }
                                ]
                            }
                        }
                    ]
                ) {
                    users {
                        id
                    }
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "CALL {
            CREATE (this0:User)
            SET this0.id = $this0_id
            SET this0.name = $this0_name
            WITH this0
            CREATE (this0_posts0_node:Post)
            SET this0_posts0_node.id = $this0_posts0_node_id
            WITH this0, this0_posts0_node
            CREATE (this0_posts0_node_creator0_node:User)
            SET this0_posts0_node_creator0_node.id = $this0_posts0_node_creator0_node_id
            WITH this0, this0_posts0_node, this0_posts0_node_creator0_node
            CALL apoc.util.validate(NOT ((this0_posts0_node_creator0_node.id IS NOT NULL AND this0_posts0_node_creator0_node.id = $this0_posts0_node_creator0_nodeauth_param0)), \\"@neo4j/graphql/FORBIDDEN\\", [0])
            MERGE (this0_posts0_node)<-[:HAS_POST]-(this0_posts0_node_creator0_node)
            WITH this0, this0_posts0_node
            CALL apoc.util.validate(NOT ((exists((this0_posts0_node)<-[:HAS_POST]-(:\`User\`)) AND all(auth_this0 IN [(this0_posts0_node)<-[:HAS_POST]-(auth_this0:\`User\`) | auth_this0] WHERE (auth_this0.id IS NOT NULL AND auth_this0.id = $this0_posts0_nodeauth_param0)))), \\"@neo4j/graphql/FORBIDDEN\\", [0])
            MERGE (this0)-[:HAS_POST]->(this0_posts0_node)
            WITH this0, this0_posts0_node
            CALL {
            	WITH this0_posts0_node
            	MATCH (this0_posts0_node)<-[this0_posts0_node_creator_User_unique:HAS_POST]-(:User)
            	WITH count(this0_posts0_node_creator_User_unique) as c
            	CALL apoc.util.validate(NOT (c = 1), '@neo4j/graphql/RELATIONSHIP-REQUIREDPost.creator required', [0])
            	RETURN c AS this0_posts0_node_creator_User_unique_ignored
            }
            WITH this0
            CALL apoc.util.validate(NOT ((this0.id IS NOT NULL AND this0.id = $this0auth_param0)), \\"@neo4j/graphql/FORBIDDEN\\", [0])
            RETURN this0
            }
            RETURN [
            this0 { .id }] AS data"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"this0_id\\": \\"user-id\\",
                \\"this0_name\\": \\"bob\\",
                \\"this0_posts0_node_id\\": \\"post-id-1\\",
                \\"this0_posts0_node_creator0_node_id\\": \\"some-user-id\\",
                \\"this0_posts0_node_creator0_nodeauth_param0\\": \\"id-01\\",
                \\"this0_posts0_nodeauth_param0\\": \\"id-01\\",
                \\"this0auth_param0\\": \\"id-01\\",
                \\"resolvedCallbacks\\": {}
            }"
        `);
    });

    test("Update Node", async () => {
        const query = gql`
            mutation {
                updateUsers(where: { id: "id-01" }, update: { id: "not bound" }) {
                    users {
                        id
                    }
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`User\`)
            WHERE this.id = $param0
            SET this.id = $this_update_id
            WITH this
            CALL apoc.util.validate(NOT ((this.id IS NOT NULL AND this.id = $thisauth_param0)), \\"@neo4j/graphql/FORBIDDEN\\", [0])
            RETURN collect(DISTINCT this { .id }) AS data"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"param0\\": \\"id-01\\",
                \\"this_update_id\\": \\"not bound\\",
                \\"thisauth_param0\\": \\"id-01\\",
                \\"resolvedCallbacks\\": {}
            }"
        `);
    });

    test("Update Nested Node", async () => {
        const query = gql`
            mutation {
                updateUsers(
                    where: { id: "id-01" }
                    update: {
                        posts: {
                            where: { node: { id: "post-id" } }
                            update: { node: { creator: { update: { node: { id: "not bound" } } } } }
                        }
                    }
                ) {
                    users {
                        id
                    }
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`User\`)
            WHERE this.id = $param0
            WITH this
            OPTIONAL MATCH (this)-[this_has_post0_relationship:HAS_POST]->(this_posts0:Post)
            WHERE this_posts0.id = $updateUsers_args_update_posts0_where_Postparam0
            CALL apoc.do.when(this_posts0 IS NOT NULL, \\"
            WITH this, this_posts0
            OPTIONAL MATCH (this_posts0)<-[this_posts0_has_post0_relationship:HAS_POST]-(this_posts0_creator0:User)
            CALL apoc.do.when(this_posts0_creator0 IS NOT NULL, \\\\\\"
            SET this_posts0_creator0.id = $this_update_posts0_creator0_id
            WITH this, this_posts0, this_posts0_creator0
            CALL apoc.util.validate(NOT ((this_posts0_creator0.id IS NOT NULL AND this_posts0_creator0.id = $this_posts0_creator0auth_param0)), \\\\\\\\\\\\\\"@neo4j/graphql/FORBIDDEN\\\\\\\\\\\\\\", [0])
            RETURN count(*) AS _
            \\\\\\", \\\\\\"\\\\\\", {this:this, this_posts0:this_posts0, updateUsers: $updateUsers, this_posts0_creator0:this_posts0_creator0, auth:$auth,this_update_posts0_creator0_id:$this_update_posts0_creator0_id,this_posts0_creator0auth_param0:$this_posts0_creator0auth_param0})
            YIELD value AS _
            WITH this, this_posts0
            CALL {
            	WITH this_posts0
            	MATCH (this_posts0)<-[this_posts0_creator_User_unique:HAS_POST]-(:User)
            	WITH count(this_posts0_creator_User_unique) as c
            	CALL apoc.util.validate(NOT (c = 1), '@neo4j/graphql/RELATIONSHIP-REQUIREDPost.creator required', [0])
            	RETURN c AS this_posts0_creator_User_unique_ignored
            }
            RETURN count(*) AS _
            \\", \\"\\", {this:this, updateUsers: $updateUsers, this_posts0:this_posts0, auth:$auth,this_update_posts0_creator0_id:$this_update_posts0_creator0_id,this_posts0_creator0auth_param0:$this_posts0_creator0auth_param0})
            YIELD value AS _
            WITH this
            CALL apoc.util.validate(NOT ((this.id IS NOT NULL AND this.id = $thisauth_param0)), \\"@neo4j/graphql/FORBIDDEN\\", [0])
            RETURN collect(DISTINCT this { .id }) AS data"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"param0\\": \\"id-01\\",
                \\"updateUsers_args_update_posts0_where_Postparam0\\": \\"post-id\\",
                \\"this_update_posts0_creator0_id\\": \\"not bound\\",
                \\"this_posts0_creator0auth_param0\\": \\"id-01\\",
                \\"auth\\": {
                    \\"isAuthenticated\\": true,
                    \\"roles\\": [
                        \\"admin\\"
                    ],
                    \\"jwt\\": {
                        \\"roles\\": [
                            \\"admin\\"
                        ],
                        \\"sub\\": \\"id-01\\"
                    }
                },
                \\"thisauth_param0\\": \\"id-01\\",
                \\"updateUsers\\": {
                    \\"args\\": {
                        \\"update\\": {
                            \\"posts\\": [
                                {
                                    \\"where\\": {
                                        \\"node\\": {
                                            \\"id\\": \\"post-id\\"
                                        }
                                    },
                                    \\"update\\": {
                                        \\"node\\": {
                                            \\"creator\\": {
                                                \\"update\\": {
                                                    \\"node\\": {
                                                        \\"id\\": \\"not bound\\"
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            ]
                        }
                    }
                },
                \\"resolvedCallbacks\\": {}
            }"
        `);
    });

    test("Connect Node", async () => {
        const query = gql`
            mutation {
                updatePosts(where: { id: "post-id" }, connect: { creator: { where: { node: { id: "user-id" } } } }) {
                    posts {
                        id
                    }
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`Post\`)
            WHERE this.id = $param0
            WITH this
            CALL {
            	WITH this
            	OPTIONAL MATCH (this_connect_creator0_node:User)
            	WHERE this_connect_creator0_node.id = $this_connect_creator0_node_param0
            	FOREACH(_ IN CASE WHEN this IS NULL THEN [] ELSE [1] END |
            		FOREACH(_ IN CASE WHEN this_connect_creator0_node IS NULL THEN [] ELSE [1] END |
            			MERGE (this)<-[:HAS_POST]-(this_connect_creator0_node)
            		)
            	)
            	WITH this, this_connect_creator0_node
            	CALL apoc.util.validate(NOT ((exists((this_connect_creator0_node)<-[:HAS_POST]-(:\`User\`)) AND all(auth_this0 IN [(this_connect_creator0_node)<-[:HAS_POST]-(auth_this0:\`User\`) | auth_this0] WHERE (auth_this0.id IS NOT NULL AND auth_this0.id = $this_connect_creator0_nodeauth_param0))) AND (this_connect_creator0_node.id IS NOT NULL AND this_connect_creator0_node.id = $this_connect_creator0_nodeauth_param0)), \\"@neo4j/graphql/FORBIDDEN\\", [0])
            	RETURN count(*) AS _
            }
            WITH *
            WITH *
            CALL {
            	WITH this
            	MATCH (this)<-[this_creator_User_unique:HAS_POST]-(:User)
            	WITH count(this_creator_User_unique) as c
            	CALL apoc.util.validate(NOT (c = 1), '@neo4j/graphql/RELATIONSHIP-REQUIREDPost.creator required', [0])
            	RETURN c AS this_creator_User_unique_ignored
            }
            RETURN collect(DISTINCT this { .id }) AS data"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"param0\\": \\"post-id\\",
                \\"this_connect_creator0_node_param0\\": \\"user-id\\",
                \\"this_connect_creator0_nodeauth_param0\\": \\"id-01\\",
                \\"resolvedCallbacks\\": {}
            }"
        `);
    });

    test("Disconnect Node", async () => {
        const query = gql`
            mutation {
                updatePosts(where: { id: "post-id" }, disconnect: { creator: { where: { node: { id: "user-id" } } } }) {
                    posts {
                        id
                    }
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`Post\`)
            WHERE this.id = $param0
            WITH this
            CALL {
            WITH this
            OPTIONAL MATCH (this)<-[this_disconnect_creator0_rel:HAS_POST]-(this_disconnect_creator0:User)
            WHERE this_disconnect_creator0.id = $updatePosts_args_disconnect_creator_where_Userparam0
            FOREACH(_ IN CASE WHEN this_disconnect_creator0 IS NULL THEN [] ELSE [1] END |
            DELETE this_disconnect_creator0_rel
            )
            WITH this, this_disconnect_creator0
            CALL apoc.util.validate(NOT ((exists((this_disconnect_creator0)<-[:HAS_POST]-(:\`User\`)) AND all(auth_this0 IN [(this_disconnect_creator0)<-[:HAS_POST]-(auth_this0:\`User\`) | auth_this0] WHERE (auth_this0.id IS NOT NULL AND auth_this0.id = $this_disconnect_creator0auth_param0))) AND (this_disconnect_creator0.id IS NOT NULL AND this_disconnect_creator0.id = $this_disconnect_creator0auth_param0)), \\"@neo4j/graphql/FORBIDDEN\\", [0])
            RETURN count(*) AS _
            }
            WITH *
            WITH *
            CALL {
            	WITH this
            	MATCH (this)<-[this_creator_User_unique:HAS_POST]-(:User)
            	WITH count(this_creator_User_unique) as c
            	CALL apoc.util.validate(NOT (c = 1), '@neo4j/graphql/RELATIONSHIP-REQUIREDPost.creator required', [0])
            	RETURN c AS this_creator_User_unique_ignored
            }
            RETURN collect(DISTINCT this { .id }) AS data"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"param0\\": \\"post-id\\",
                \\"updatePosts_args_disconnect_creator_where_Userparam0\\": \\"user-id\\",
                \\"this_disconnect_creator0auth_param0\\": \\"id-01\\",
                \\"updatePosts\\": {
                    \\"args\\": {
                        \\"disconnect\\": {
                            \\"creator\\": {
                                \\"where\\": {
                                    \\"node\\": {
                                        \\"id\\": \\"user-id\\"
                                    }
                                }
                            }
                        }
                    }
                },
                \\"resolvedCallbacks\\": {}
            }"
        `);
    });
});