import * as fs from 'fs';
import * as path from 'path';
import * as _ from 'lodash';
import pgPromise from 'pg-promise';
import { IConnectionParameters } from 'pg-promise/typescript/pg-subset';
import { Logger } from 'tslog';
import { Config } from './config';
import * as fsExtra from "fs-extra";

export declare interface ChattersData {
    channel: string,
    total_chatters: number,
    chatters: string[]
}

export declare interface DBOverlapEntry {
    channel_name: string,
    timestamp: number,
    overlap_count: number,
    total_chatters: number,
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
};

const options: pgPromise.IInitOptions<IExtensions> = {
    extend(obj) {
        obj.createChannel = (channel) => {
            return obj.none(`CREATE TABLE IF NOT EXISTS ${channel.toLowerCase()} ( id SERIAL, channel_name VARCHAR(50), timestamp NOT NULL, overlap_count INTEGER, total_chatters INTEGER, PRIMARY KEY(id) );`);
        }
    }
};

export class Database {

    private log: Logger = new Logger({ name: 'Database' });

    // Database connection
    private pgp = pgPromise(options);
    private db;
    private columnSets: Map<string, pgPromise.ColumnSet>;

    // Current channel #, performs calculations when all channels have been queried 
    private channel_iteration: number;

    // Current total chatters, map should be erased every iteration
    private currentTotalChatters: Map<string, number>;

    constructor() {
        this.channel_iteration = 0;
        this.columnSets = new Map<string, pgPromise.ColumnSet>();
        this.currentTotalChatters = new Map<string, number>();
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

        this.log.info(`Initialized Database.`);
    }

    // TODO: Flush overlaps to database
    public async flushOverlaps(): Promise<void> {
        /*
            1. Wait for results of calculateOverlaps()
            2. Write overlaps to database (look at schema you made in workbench)
            2a. Look at column sets for writing
            3. Delete temp files created by writeChatters()
            4. Reset channel iteration
        */

        // Write to database
        const timestamp: number = new Date().valueOf();
        let overlaps: Map<string, [string, number][]> = await this.calculateOverlaps();
        for await (const channel of overlaps.keys()) {
            await this.flushChannel(channel, overlaps.get(channel), this.currentTotalChatters.get(channel), timestamp);
        }

        // Delete temporary files
        // TODO: Use fs-extra
    }

    private async flushChannel(channel: string, overlaps: [string, number][], total_chatters: number, timestamp: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            // Build database insertions
            const entries: DBOverlapEntry[] = [];
            for(const [channel_name, overlap_count] of overlaps) {
                entries.push({
                    channel_name: channel_name,
                    timestamp: timestamp,
                    overlap_count: overlap_count,
                    total_chatters: total_chatters,
                } as DBOverlapEntry);
            }

            const query = this.pgp.helpers.insert(entries, this.columnSets.get(channel));
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
            this.db.createChannel().then(res => {
                this.columnSets.set(table_name, new this.pgp.helpers.ColumnSet(['channel_name', 'timestamp', 'overlap_count', 'total_chatters'], { table: table_name }));
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
            fs.writeFile(path.join(...[ OUTPUT_PATH, `${data.channel.toLowerCase}.json` ]), JSON.stringify(data), (err) => {
                this.channel_iteration++; // TODO: Call calculation functions when all channels have been recorded 
                if(err) {
                    this.log.warn(`Failed to write chatter data for ${data.channel}. Error: ${err}`);
                    reject(err);
                } else {
                    this.log.debug(`Flushed chatter data for ${data.channel} to temporary file.`);
                    if(this.channel_iteration >= Config.config.channels.length) this.flushOverlaps(); // TODO: Move this
                    resolve();
                }
            });
        });
    }

    // Calculates overlaps for channels after each data collection period
    public async calculateOverlaps(): Promise<Map<string, [string, number][]>> {
        let overlaps = new Map<string, [string, number][]>();
        for(const channel of Config.config.channels) {
            let channel_overlaps: [string, number][] = [];
            try {
                channel_overlaps = await this.findOverlapsForChannel(channel);
            } catch (err: any) {
                this.log.error(`Error occured while calculating overlaps. Error: ${err}`);
            }

            overlaps.set(channel, channel_overlaps);
        }

        return overlaps;
    }

    // Finds overlaps for channel compared with all other channels in config
    private async findOverlapsForChannel(channel: string): Promise<[string, number][]> {
        return new Promise<[string, number][]>((resolve, reject) => {
            this.readChatterFile(channel).then(data => {
                this.currentTotalChatters.set(channel, data.total_chatters);

                // Build Promise array
                let promises: Promise<[string, number]>[] = [];
                Config.config.channels.forEach((other_channel) => {
                    if(!(channel === other_channel)) {
                        promises.push(this.findOverlap(channel, data.chatters, other_channel));
                    }
                });

                Promise.all(promises)
                    .then(values => resolve(values))
                    .catch(err => reject(err));
            
            }).catch(err => reject(err));
        });
    }

    // Finds overlap for channel with chatters[] compared to other channel
    private async findOverlap(channel: string, chatters: string[], other_channel: string): Promise<[string, number]> {
        return new Promise<[string, number]>((resolve, reject) => {
            this.readChatterFile(other_channel).then(other_chatters => {
                const overlap: number = _.intersection(chatters, other_chatters.chatters).length;
                resolve([channel, overlap]);
            }).catch(err => reject(err));
        });
    }

    private async readChatterFile(channel: string): Promise<ChattersData> {
        return new Promise<ChattersData>((resolve, reject) => {
            fs.readFile(path.join(...[OUTPUT_PATH, `${channel.toLowerCase()}.json`]), (err, data) => {
                if(err) {
                    this.log.warn(`Failed to read file for ${channel}. Error: ${err}`);
                    reject(err);
                }

                const chatter_data: ChattersData = JSON.parse(data.toString('utf-8')) as ChattersData;
                resolve(chatter_data);
            });
        });
    }

}