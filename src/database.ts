import * as fs from 'fs';
import * as path from 'path';
import * as _ from 'lodash';
import pgPromise from 'pg-promise';
import { IConnectionParameters } from 'pg-promise/typescript/pg-subset';
import { ISettingsParam, Logger } from 'tslog';
import { Config } from './config';
import * as fsExtra from "fs-extra";
import { TSLOG_OPTIONS, Main } from './main';
import { channel } from 'diagnostics_channel';
import { table } from 'console';
import { reject } from 'lodash';

export declare interface ChattersData {
    channel: string,
    total_chatters: number,
    chatters: string[],
}

export declare interface DBOverlapEntry {
    iteration: number,
    channel_name: string,
    overlap_count: number,
    total_chatters: number,
}

export declare interface DBUserInfoEntry {
    channel_name: string,
    channel_id: string,
    description: string,
    creation_date: string,
}

export declare interface DBStreamInfoEntry {
    iteration: number,
    channel_name: string,
    category_name: string,
    category_id: string,
    title: string,
    uptime: number,
    viewer_count: number,
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
    createStreamInfoTable(): Promise<void>;
    createIterationsTable(): Promise<void>;
};

const options: pgPromise.IInitOptions<IExtensions> = {
    extend(obj) {
        obj.createChannel = (channel: string) => {
            return obj.none(`CREATE TABLE IF NOT EXISTS ${channel.toLowerCase()} (
                 id SERIAL, iteration INTEGER, channel_name VARCHAR(26), 
                 overlap_count INTEGER NOT NULL, total_chatters INTEGER, PRIMARY KEY(id) );`);
        }

        obj.createUserInfoTable = () => {
            return obj.none(`CREATE TABLE IF NOT EXISTS users (channel_name VARCHAR(26), channel_id VARCHAR(12),
                 description TEXT, creation_date TIMESTAMP, PRIMARY KEY(channel_name) );`);
        }

        obj.createStreamInfoTable = () => {
            return obj.none(`CREATE TABLE IF NOT EXISTS streams (id SERIAL, iteration INTEGER, channel_name VARCHAR(26), category_name VARCHAR(200),
                 category_id VARCHAR(20), title VARCHAR(170), language VARCHAR(3), PRIMARY KEY(id) );`);
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

    // Channels already in user database
    private registeredUsers: string[];

    constructor() {
        this.columnSets = new Map<string, pgPromise.ColumnSet>();
        this.registeredUsers = [];
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

        // Initializate auxillary databases
        await this.db.createUserInfoTable();
        await this.db.createStreamInfoTable();
        await this.db.createIterationsTable();
        this.log.debug(`Added tables: users, streams, iterations.`);

        // Add additional database column sets
        this.columnSets.set('_users_', new this.pgp.helpers.ColumnSet([ 'channel_name', 'channel_id', 'description', 'creation_date' ], { table: 'users' }));
        this.columnSets.set('_streams_', new this.pgp.helpers.ColumnSet([ 'iteration', 'channel_name', 'category_name', 'category_id', 'title', 'language' ], { table: 'streams' }));
        this.columnSets.set('_iterations_', new this.pgp.helpers.ColumnSet([ 'iteration', 'timestamp' ], { table: 'iterations' }));

        // Load users from users database into map to avoid conflicts
        const loaded_channels: string[] = await this.db.any(`SELECT channel_name FROM users;`);
        this.registeredUsers = loaded_channels;
        this.log.debug(`Loaded ${loaded_channels.length} users from users table into memory.`);

        // Clear temp folder
        fsExtra.emptyDirSync(OUTPUT_PATH);

        this.log.info(`Initialized Database.`);
    }

    public async flushUserInfo(entries: DBUserInfoEntry[]): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.log.debug(`Flushing user info of ${entries.length} entries.`);
            this.db.none(this.pgp.helpers.insert(entries, this.columnSets.get('_users_'))).then(res => {
                this.log.debug(`Successfully flushed ${entries.length} user info entries to users database.`);
                for(const channel of entries) {
                    this.registeredUsers.push(channel.channel_name);
                }

                resolve();
            }).catch(err => {
                this.log.error(`Failed to flush user info entries to database. Error: ${err}.`);
                reject(err);
            });
        });
    }

    public async flushStreamInfo(entries: DBStreamInfoEntry[]): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.log.debug(`Flushing stream info of ${entries.length} entries.`);
            this.db.none(this.pgp.helpers.insert(entries, this.columnSets.get('_streams_'))).then(res => {
                this.log.debug(`Successfully flushed ${entries.length} stream info entries to streams database.`);
                resolve();
            }).catch(err => {
                this.log.error(`Failed to flush stream info entries to database. Error: ${err}.`);
                reject(err);
            });
        });
    }

    public async flushIterations(entries: DBIterationEntry[]): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.log.debug(`Flushing iterations info of ${entries.length} entries.`);
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

        // Create tables for all channels if they don't exist
        for await (const channel of Main.channels) {
            await this.addChannel(channel);
        }

        // Write to database
        const timestamp = this.getDatabaseTimestamp();
        try {
            let overlaps: Map<string, [string, number][]> = await Main.overlaps.calculateOverlaps();
            for await (const channel of overlaps.keys()) {
                await this.flushChannel(channel, overlaps.get(channel), Main.currentTotalChatters.get(channel), timestamp);
            }
        } catch (err) {
            this.log.error(`Error occured while flushing overlaps to database: ${err}.`);
            throw Error(err);
        }

        this.log.debug(`Flushed overlaps to database, performing clean up...`);

        // Delete temporary files
        fsExtra.emptyDirSync(OUTPUT_PATH);
        Main.currentTotalChatters.clear();
    }

    private async flushChannel(channel: string, overlaps: [string, number][], total_chatters: number, timestamp: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            // Build database insertions
            const entries: DBOverlapEntry[] = [];
            for(const [channel_name, overlap_count] of overlaps) {
                let entry: DBOverlapEntry = {
                    iteration: Main.currentIteration,
                    channel_name: channel_name,
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
                let column: pgPromise.ColumnSet = new this.pgp.helpers.ColumnSet(['iteration', 'channel_name', 'overlap_count', 'total_chatters'], { table: table_name });
                this.columnSets.set(table_name, column);
                this.log.debug(`Added table "${table_name}" to database.`);
                resolve();
            }).catch(err => {
                this.log.error(`Failed to create table for channel '${channel}'.`);
                reject(err);
            });
        });
    }

    public async writeChatters(data: ChattersData): Promise<void> {
        const output_file: string = path.join(...[ OUTPUT_PATH, `${data.channel.toLowerCase()}.json` ]);
        const chatterFileExists: boolean = this.fileExists(output_file);
        let writeData: ChattersData;
        if(chatterFileExists) {
            this.log.debug(`File for ${data.channel} already exists, reading chatters.`);
            // Load existing chatters from file
            const rawText: string = (await fs.promises.readFile(output_file)).toString();
            const oldData: ChattersData = JSON.parse(rawText) as ChattersData;

            // Find union of chatters and update total chatters
            const chattersUnion: string[] = _.union(oldData.chatters, data.chatters);
            writeData = {
                channel: data.channel,
                total_chatters: chattersUnion.length,
                chatters: chattersUnion,
            } as ChattersData;
        } else {
            writeData = data;
        }

        // Write data
        try {
            await fs.promises.writeFile(output_file, JSON.stringify(writeData));
            this.log.debug(`Wrote ${writeData.total_chatters} chatters for channel ${writeData.channel} to temporary file`);
        } catch (err) {
            this.log.error(`Failed to write chatter data to file: ${err}`);
            throw Error(err);
        }
        
        Main.currentTotalChatters.set(writeData.channel, writeData.total_chatters);
    }

    // Returns a list of users not already in the users table for API to process
    public async getUsersNotInDatabase(users: string[]): Promise<string[]> {
        return new Promise<string[]>((resolve) => {
            let users_not_stored: string[] = [];
            for(const user of users) {
                if(!this.registeredUsers.includes(user)) {
                    users_not_stored.push(user);
                }
            }

            resolve(users_not_stored);
        });
    }

    public async writeNewIteration(iteration: DBIterationEntry): Promise<void> {
        try {
            const query = this.pgp.helpers.insert(iteration, this.columnSets.get('_iterations_'));
            await this.db.none(query);
        } catch (err) {
            this.log.error(`Error occured while writing new iteration to database: ${err}.`);
            throw Error(err);
        }
    }

    public getDatabaseTimestamp(): string {
        let now = new Date();
        //now.setMinutes(Math.ceil(now.getMinutes() / 30) * 30);
        return now.toISOString().slice(0, 19).replace('T', ' ');
    }

    private fileExists(file: string): boolean {
        if(fs.existsSync(file)) {
            return true;
        } else {
            return false;
        }
    }

}