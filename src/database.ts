import * as fs from 'fs';
import * as path from 'path';
import * as _ from 'lodash';
import pgPromise from 'pg-promise';
import { IConnectionParameters } from 'pg-promise/typescript/pg-subset';
import { ISettingsParam, Logger } from 'tslog';
import { Config } from './config';
import * as fsExtra from "fs-extra";
import { scraper, TSLOG_OPTIONS } from './main';
import { calcOverlaps, currentTotalChatters } from './globals';
import { channel } from 'diagnostics_channel';
import { table } from 'console';

export declare interface ChattersData {
    channel: string,
    total_chatters: number,
    chatters: string[]
}

export declare interface DBOverlapEntry {
    iteration: number,
    channel_name: string,
    timestamp: string,
    overlap_count: number,
    total_chatters: number,
}

export declare interface DBUserInfoEntry {
    channel_name: string,
    channel_id: string,
    description: string,
    broadcaster_type: number,
    creation_date: string,
}

export declare interface DBBroadcastInfoEntry {
    iteration: number,
    channel_name: string,
    category_name: string,
    category_id: string,
    title: string,
    language: string,
}

export declare interface DBIterationEntry {
    iteration: number,
    timestamp: string,
}


const OUTPUT_PATH: string = process.env.OUTPUT_PATH || '/usr/share/tracker/chatters';

// Postgres configuration for dev environment
const dev_dbConfig = {
    host: 'db',
    port: '5432',
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD
};

interface IExtensions {
    createChannel(channel: string): Promise<any>; // promise null?
    createUserInfoTable(): Promise<void>;
    createBroadcastInfoTable(): Promise<void>;
    createIterationsTable(): Promise<void>;
};

const options: pgPromise.IInitOptions<IExtensions> = {
    extend(obj) {
        obj.createChannel = (channel: string) => {
            return obj.none(`CREATE TABLE IF NOT EXISTS ${channel.toLowerCase()} (
                 id SERIAL, iteration INTEGER, channel_name VARCHAR(60), timestamp TIMESTAMP NOT NULL, 
                 overlap_count NOT NULL INTEGER, total_chatters INTEGER, PRIMARY KEY(id) );`);
        }

        obj.createUserInfoTable = () => {
            return obj.none(`CREATE TABLE IF NOT EXISTS users (channel_name VARCHAR(26), channel_id NOT NULL VARCHAR(10),
                 description TEXT, broadcaster_type SMALLINT, creation_date TIMESTAMP, PRIMARY KEY(channel_name) );`);
        }

        obj.createBroadcastInfoTable = () => {
            return obj.none(`CREATE TABLE IF NOT EXISTS broadcasts (id SERIAL, iteration INTEGER, channel_name VARCHAR(26), category_name VARCHAR(100),
                 category_id VARCHAR(8), title VARCHAR(150), language VARCHAR(2), PRIMARY KEY(id) );`);
        }

        obj.createIterationsTable = () => {
            return obj.none(`CREATE TABLE IF NOT EXISTS iterations (iteration INTEGER, timestamp TIMESTAMP NOT NULL, PRIMARY KEY(iteration) );`);
        }
    }
};

export class Database {

    private log: Logger = new Logger({ name: 'Database', ...TSLOG_OPTIONS } as ISettingsParam);

    // Database connection
    private pgp = pgPromise(options);
    private db;
    private columnSets: Map<string, pgPromise.ColumnSet>;

    constructor() {
        this.columnSets = new Map<string, pgPromise.ColumnSet>();
    }

    public async init(): Promise<void> {
        // Initialize database connection
        const isProduction: boolean = (process.env.NODE_ENV === 'production');
        const dbConfig = (isProduction ? process.env.DATABASE_URL : dev_dbConfig); // Check build environment
        if(process.env.NODE_ENV === 'production') {
            // Change SSL default if in production
            this.pgp.pg.defaults.ssl = { rejectUnauthorized: false };
        }

        this.db = this.pgp(dbConfig as IConnectionParameters);

        for await (const channel of Config.config.channels) {
            await this.addChannel(channel);
        }

        // Initializate auxillary databases
        await this.db.createUserInfoTable();
        await this.db.createBroadcastInfoTable();
        await this.db.createIterationsTable();

        // Add additional database column sets
        this.columnSets.set('_users_', new this.pgp.helpers.ColumnSet([ 'channel_name', 'channel_id', 'description', 'broadcaster_type', 'creation_date' ], { table: 'users' }));
        this.columnSets.set('_broadcasts_', new this.pgp.helpers.ColumnSet([ 'iteration', 'channel_name', 'category_name', 'category_id', 'title', 'language' ], { table: 'broadcasts' }));
        this.columnSets.set('_iterations_', new this.pgp.helpers.ColumnSet([ 'iteration', 'timestamp' ], { table: 'iterations' }));

        // Clear temp folder
        fsExtra.emptyDirSync(OUTPUT_PATH);

        this.log.info(`Initialized Database.`);
    }

    public async flushUserInfo(entries: DBUserInfoEntry[]): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.db.none(this.pgp.helpers.insert(entries, this.columnSets.get('_users_'))).then(res => {
                this.log.debug(`Successfully flushed ${entries.length} user info entries to users database.`);
                resolve();
            }).catch(err => {
                this.log.error(`Failed to flush user info entries to database. Error: ${err}.`);
                reject(err);
            });
        });
    }

    public async flushBroadcastInfo(entries: DBBroadcastInfoEntry[]): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.db.none(this.pgp.helpers.insert(entries, this.columnSets.get('_broadcasts_'))).then(res => {
                this.log.debug(`Successfully flushed ${entries.length} broadcast info entries to broadcasts database.`);
                resolve();
            }).catch(err => {
                this.log.error(`Failed to flush broadcast info entries to database. Error: ${err}.`);
                reject(err);
            });
        });
    }

    public async flushIterations(entries: DBIterationEntry[]): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.db.none(this.pgp.helpers.insert(entries, this.columnSets.get('_iterations_'))).then(res => {
                this.log.debug(`Successfully flushed ${entries.length} broadcast iteration entries to iterations database.`);
                resolve();
            }).catch(err => {
                this.log.error(`Failed to flush iteration info entries to database. Error: ${err}.`);
                reject(err);
            });
        });
    }

    public async flushOverlaps(): Promise<void> {
        /*
            1. Wait for results of calculateOverlaps()
            2. Write overlaps to database (look at schema you made in workbench)
            2a. Look at column sets for writing
            3. Delete temp files created by writeChatters()
            4. Reset channel iteration
        */

            this.log.info("Calculating overlaps...");

        // Write to database
        const timestamp = this.getDatabaseTimestamp();
        let overlaps: Map<string, [string, number][]> = await calcOverlaps.calculateOverlaps();
        for await (const channel of overlaps.keys()) {
            await this.flushChannel(channel, overlaps.get(channel), currentTotalChatters.get(channel), timestamp);
        }

        // Delete temporary files
        fsExtra.emptyDirSync(OUTPUT_PATH);
        currentTotalChatters.clear();
        scraper.startCollection();
    }

    private async flushChannel(channel: string, overlaps: [string, number][], total_chatters: number, timestamp: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            // Build database insertions
            const entries: DBOverlapEntry[] = [];
            for(const [channel_name, overlap_count] of overlaps) {
                let entry: DBOverlapEntry = {
                    iteration: Config.config.iteration,
                    channel_name: channel_name,
                    timestamp: timestamp,
                    overlap_count: overlap_count,
                    total_chatters: total_chatters,
                };

                entries.push(entry);
            }

            const query = this.pgp.helpers.insert(entries, this.columnSets.get(channel.toLowerCase()));
            this.db.none(query).then(res => {
                resolve();
            }).catch(err => {
                this.log.error(`Failed to flush overlaps for table ${channel}. Error: ${err}.`);
                reject(err);
            })
        });
    }

    async addChannel(channel: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const table_name: string = channel.toLowerCase();
            this.db.createChannel(table_name).then(res => {
                let column: pgPromise.ColumnSet = new this.pgp.helpers.ColumnSet(['channel_name', 'timestamp', 'overlap_count', 'total_chatters'], { table: table_name });
                this.columnSets.set(table_name, column);
                this.log.debug(`Added table "${table_name}" to database.`);
                resolve();
            }).catch(err => {
                this.log.error(`Failed to create table for channel '${channel}'.`);
                reject(err);
            });
        });
    }

    // Writes list of chatters to a local file to be compared with others at once
    public async writeChatters(data: ChattersData): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            currentTotalChatters.set(data.channel, data.total_chatters);
            fs.writeFile(path.join(...[ OUTPUT_PATH, `${data.channel.toLowerCase()}.json` ]), JSON.stringify(data), (err) => {
                if(err) {
                    this.log.warn(`Failed to write chatter data for ${data.channel}. Error: ${err}`);
                    reject(err);
                } else {
                    this.log.debug(`Flushed chatter data for ${data.channel} to temporary file.`);
                    resolve();
                }
            });
        });
    }

    private getDatabaseTimestamp(): string {
        let now = new Date();
        now.setMinutes(Math.ceil(now.getMinutes() / 30) * 30);
        return now.toISOString().slice(0, 19).replace('T', ' ');
    }

}