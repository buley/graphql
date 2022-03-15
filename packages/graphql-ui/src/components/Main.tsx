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

import { SideBar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { useContext, useState } from "react";
import { Login } from "./Login";
import { SchemaEditor } from "./SchemaEditor";
import { GraphQLSchema } from "graphql";
import { Editor } from "./editor/Editor";
import { AuthContext } from "../contexts/auth";
import { ScreenContext, Screen } from "../contexts/screen";

export enum Pages {
    TYPEDEFS,
    EDITOR,
}

export const Main = () => {
    const auth = useContext(AuthContext);
    const sidebar = useContext(ScreenContext);
    const [schema, setSchema] = useState<GraphQLSchema | undefined>(undefined);

    if (!auth.driver) {
        return (
            <div className="flex">
                <div className="flex w-full h-full flex-col">
                    <Login />
                </div>
            </div>
        );
    }

    return (
        <div className="flex">
            <SideBar
                allowRedirectToEdit={!!schema}
                onLogout={() => {
                    sidebar.setView(Screen.TYPEDEFS);
                    setSchema(undefined);
                }}
            />
            <div className="flex w-full h-full flex-col">
                <TopBar />
                <div className="h-content-container w-full p-4 overflow-y-auto n-bg-neutral-20">
                    {sidebar.view === Screen.TYPEDEFS ? (
                        <SchemaEditor
                            onChange={(schema) => {
                                setSchema(schema);
                                sidebar.setView(Screen.EDITOR);
                            }}
                        ></SchemaEditor>
                    ) : (
                        <Editor schema={schema} />
                    )}
                </div>
            </div>
        </div>
    );
};
