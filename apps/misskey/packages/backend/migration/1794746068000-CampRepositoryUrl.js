/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class CampRepositoryUrl1794746068000 {
    name = 'CampRepositoryUrl1794746068000';

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" ALTER COLUMN "repositoryUrl" SET DEFAULT 'https://github.com/stellasora-cafe/trekker-camp'`);
        await queryRunner.query(`UPDATE "meta" SET "repositoryUrl" = 'https://github.com/stellasora-cafe/trekker-camp' WHERE "repositoryUrl" = 'https://github.com/misskey-dev/misskey'`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" ALTER COLUMN "repositoryUrl" SET DEFAULT 'https://github.com/misskey-dev/misskey'`);
        await queryRunner.query(`UPDATE "meta" SET "repositoryUrl" = 'https://github.com/misskey-dev/misskey' WHERE "repositoryUrl" = 'https://github.com/stellasora-cafe/trekker-camp'`);
    }
}
