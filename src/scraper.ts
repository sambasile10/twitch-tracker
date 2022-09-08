import { Queue } from 'queue-typescript';
import { Config } from './config';
import axios from 'axios';
import { Logger } from 'tslog';
import { ChattersData } from './database';

// Fetch data for each channel every x seconds
const FETCH_CHANNEL_INTERVAL: number = (Number(process.env.FETCH_INTERVAL) || 30) * 60;

export class Scraper {

    private log: Logger = new Logger({ name: 'Scraper' });
    private queue: Queue<string>;

    constructor() {
        this.queue = new Queue<string>(...Config.config.channels);
    }

    public start(writeChatters: (data: ChattersData) => void): void {
        const num_channels: number = Config.config.channels.length;
        const interval: number = (FETCH_CHANNEL_INTERVAL / num_channels) * 1000;

        this.log.info(`Fetching data for ${num_channels} channels every ${FETCH_CHANNEL_INTERVAL} seconds. Interval of ${interval} ms.`);
        setInterval(() => {
            let channel: string = this.queue.dequeue();
            this.getChattersForChannel(channel).then(data => {
                this.log.debug(`Fetched ${data.total_chatters} chatters for ${channel}.`);

                // Database callback
                writeChatters(data);

                this.queue.enqueue(channel);
            }).catch(err => {
                this.log.warn(`Failed to fetch chatters for ${channel}. Reason: ${err}`);
                this.queue.enqueue(channel);
            });
        }, interval);
    }

    public async getChattersForChannel(channel: string): Promise<ChattersData> {
        return new Promise<ChattersData>((resolve, reject) => {
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
}