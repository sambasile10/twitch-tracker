import { Queue } from 'queue-typescript';
import { Config } from './config';
import axios from 'axios';
import { ISettingsParam, Logger } from 'tslog';
import { ChattersData } from './database';
import { Main, TSLOG_OPTIONS } from './main';

// Fetch data for each channel every x seconds
const FETCH_CHANNEL_INTERVAL: number = (Number(process.env.FETCH_INTERVAL) || 30);

export class Scraper {

    private log: Logger = new Logger({ name: 'Scraper', ...TSLOG_OPTIONS } as ISettingsParam);
    private queue: Queue<string>;

    private dbCallback: (data: ChattersData) => void;
    private collectionRunner;

    constructor() {}

    public init(writeChatters: (data: ChattersData) => void): void {
        this.dbCallback = writeChatters;
    }

    public async getChattersForChannel(channel: string): Promise<ChattersData> {
        return new Promise<ChattersData>((resolve, reject) => {
            this.log.debug(`Fetching chatters for ${channel}...`);
            axios.get(`http://tmi.twitch.tv/group/user/${channel.toLowerCase()}/chatters`)
            .then(res => {
                if(!res.data.chatters) reject(`Chatters object does not exist on response for ${channel}.`);
                resolve({
                    channel: channel,
                    total_chatters: res.data.chatter_count,
                    chatters: [ ...res.data.chatters.vips, ...res.data.chatters.moderators, ...res.data.chatters.viewers ],
                });
            }).catch(err => {
                reject(err);
            });
        });
    }

    public startCollection(channels: string[]): void {
        const num_channels: number = channels.length;
        const interval: number = (FETCH_CHANNEL_INTERVAL / num_channels) * 1000;
        this.queue = new Queue<string>(...channels);
        this.log.info(`Queue length is ${this.queue.length}`);

        this.log.info(`Fetching data for ${num_channels} channels every ${FETCH_CHANNEL_INTERVAL} seconds. Interval of ${interval} ms.`);
        this.collectionRunner = setInterval(() => {
            if(this.queue.length === 0) {
                // Queue is empty
                this.log.warn(`Calling for database flush`);
                Main.handleEndOfQueue();
                this.stopCollection();
            }

            let channel: string = this.queue.dequeue();
            this.getChattersForChannel(channel).then(data => {
                this.log.debug(`Fetched ${data.total_chatters} chatters for ${channel}. Position in Queue: ${this.queue.length}.`);

                // Database callback
                this.dbCallback(data);
            }).catch(err => {
                this.log.warn(`Failed to fetch chatters for ${channel}. Reason: ${err}`);
                this.queue.enqueue(channel);
            });
        }, interval);
    }

    private stopCollection(): void {
        this.queue = new Queue<string>();
        clearInterval(this.collectionRunner);
    }
}