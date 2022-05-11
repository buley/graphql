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

import type { Connection as AmqpConnection } from "amqplib";
import { EventEmitter } from "events";
import { Neo4jGraphQLSubscriptionsPlugin, SubscriptionsEvent } from "@neo4j/graphql";
import { AmqpApi, ConnectionOptions } from "./amqp-0-9-1-api";

export { ConnectionOptions } from "./amqp-0-9-1-api";

const DEFAULT_EXCHANGE = "neo4j.graphql.subscriptions.fx";
const DEFAULT_VERSION: AmqpVersion = "0-9-1";

type AmqpVersion = "0-9-1";

export type Neo4jGraphQLSubscriptionsAMQPConstructorOptions = { amqpVersion?: AmqpVersion; exchange?: string };

export class Neo4jGraphQLSubscriptionsAMQP implements Neo4jGraphQLSubscriptionsPlugin {
    public events: EventEmitter;
    private amqpApi: AmqpApi<SubscriptionsEvent>;

    constructor(options: Neo4jGraphQLSubscriptionsAMQPConstructorOptions = {}) {
        const defaultOptions = { exchange: DEFAULT_EXCHANGE, amqpVersion: DEFAULT_VERSION };
        const finalOptions = { ...defaultOptions, ...options };

        this.events = new EventEmitter();
        this.amqpApi = new AmqpApi({ exchange: finalOptions.exchange });
    }

    public async connect(connectionOptions: ConnectionOptions): Promise<AmqpConnection> {
        return this.amqpApi.connect(connectionOptions, (message: SubscriptionsEvent) => {
            this.events.emit(message.event as string, message);
        });
    }

    /* Closes the channel created and unbinds the event emitter */
    public close(): Promise<void> {
        this.events.removeAllListeners();
        return this.amqpApi.close();
    }

    public publish(eventMeta: SubscriptionsEvent): Promise<void> {
        this.amqpApi.publish(eventMeta);
        return Promise.resolve(); // To avoid future breaking changes, we always return a promise
    }
}