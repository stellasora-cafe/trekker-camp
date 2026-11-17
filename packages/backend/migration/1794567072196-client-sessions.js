/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ClientSessions1794567072196 {
    name = 'ClientSessions1794567072196';

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "client_session" ("id" varchar(32) NOT NULL, "tokenHash" varchar(64) NOT NULL, "userId" varchar(32) NOT NULL, "kind" varchar(16) NOT NULL, "name" varchar(128) NOT NULL, "platform" varchar(64) NOT NULL, "createdAt" timestamp with time zone NOT NULL, "lastActiveAt" timestamp with time zone NOT NULL, "ip" varchar(128) NOT NULL, "userAgent" varchar(512) NOT NULL, CONSTRAINT "PK_client_session" PRIMARY KEY ("id"), CONSTRAINT "FK_client_session_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_client_session_token_hash" ON "client_session" ("tokenHash")`);
        await queryRunner.query(`CREATE INDEX "IDX_client_session_user" ON "client_session" ("userId")`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP TABLE "client_session"`);
    }
}
