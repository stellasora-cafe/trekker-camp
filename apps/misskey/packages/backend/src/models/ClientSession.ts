/*
 * SPDX-FileCopyrightText: trekker-camp contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { MiUser } from './User.js';
import { id } from './util/id.js';

@Entity('client_session')
export class MiClientSession {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_client_session' })
	public id: string;

	@Index('IDX_client_session_token_hash', { unique: true })
	@Column('varchar', { length: 64 })
	public tokenHash: string;

	@Index('IDX_client_session_user')
	@Column(id())
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ foreignKeyConstraintName: 'FK_client_session_user' })
	public user: MiUser | null;

	@Column('varchar', { length: 16 })
	public kind: 'web' | 'desktop';

	@Column('varchar', { length: 128 })
	public name: string;

	@Column('varchar', { length: 64 })
	public platform: string;

	@Column('timestamp with time zone')
	public createdAt: Date;

	@Column('timestamp with time zone')
	public lastActiveAt: Date;

	@Column('varchar', { length: 128 })
	public ip: string;

	@Column('varchar', { length: 512 })
	public userAgent: string;
}
