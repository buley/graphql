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
import { wrapInApocRunFirstColumn } from "./apoc-run";

describe("apoc translation utils", () => {
    describe("wrapInApocRunFirstColumn", () => {
        test("wraps and escapes a query inside runFirstColumn", () => {
            const result = wrapInApocRunFirstColumn(new Cypher.RawCypher(`MATCH(n) RETURN n, "Hello"`)).build();
            expect(result.cypher).toBe(`apoc.cypher.runFirstColumnMany("MATCH(n) RETURN n, \\"Hello\\"", {  })`);
            expect(result.params).toMatchObject({});
        });
        test("adds extra params", () => {
            const result = wrapInApocRunFirstColumn(new Cypher.RawCypher(`MATCH(n) RETURN n`), {
                auth: "auth",
            }).build();
            expect(result.cypher).toBe(`apoc.cypher.runFirstColumnMany("MATCH(n) RETURN n", { auth: auth })`);
            expect(result.params).toMatchObject({});
        });
        test("double wrap", () => {
            const firstWrap = wrapInApocRunFirstColumn(new Cypher.RawCypher(`MATCH(n) RETURN n, "Hello"`));
            const result = wrapInApocRunFirstColumn(firstWrap).build();
            expect(result.cypher).toBe(
                // no-useless-escape disabled due to how escaped strings work when comparing strings.
                // eslint-disable-next-line no-useless-escape
                `apoc.cypher.runFirstColumnMany(\"apoc.cypher.runFirstColumnMany(\\\"MATCH(n) RETURN n, \\\\\\\"Hello\\\\\\\"\\\", {  })\", {  })`
            );
            expect(result.params).toMatchObject({});
        });
    });
});
