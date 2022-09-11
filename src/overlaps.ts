import * as fs from 'fs';
import * as path from 'path';
import * as _ from 'lodash';
import { ISettingsParam, Logger } from 'tslog';
import { Config } from './config';
import { TSLOG_OPTIONS } from './main';
import { ChattersData } from './database';

const OUTPUT_PATH: string = process.env.OUTPUT_PATH || '/usr/share/tracker/chatters';

export class Overlaps {

    constructor() {

    }

    private log: Logger = new Logger({ name: 'Database', ...TSLOG_OPTIONS } as ISettingsParam);

    // Calculates overlaps for channels after each data collection period
    public async calculateOverlaps(): Promise<Map<string, [string, number][]>> {
        let overlaps = new Map<string, [string, number][]>();
        for(const channel of Config.config.channels) {
            let channel_overlaps: [string, number][] = [];
            this.log.debug(`Calculating overlaps for ${channel}.`);
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
                this.log.debug(`Found overlap of ${overlap} between ${channel} and ${other_channel}.`);
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