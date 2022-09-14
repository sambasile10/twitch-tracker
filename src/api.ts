import axios from 'axios';
import { ISettingsParam, Logger } from 'tslog';
import { Main, TSLOG_OPTIONS } from './main';
import { Secrets } from './secrets';
import TwitchApi from 'node-twitch';
import { APIStreamResponse } from 'node-twitch/dist/types/responses';
import { Stream } from 'node-twitch/dist/types/objects';
import { DBStreamInfoEntry, DBUserInfoEntry } from './database';
import { Config } from './config';

export class TwitchAPI {

    private log: Logger = new Logger({ name: "TwitchAPI", ...TSLOG_OPTIONS } as ISettingsParam);

    private twitch: TwitchApi;
    private secrets: Secrets;

    constuctor() {
        //this.init();
    }

    public async init(): Promise<void> {
        this.secrets = new Secrets();
        await this.secrets.init();
        this.twitch = new TwitchApi({
            client_id: this.secrets.getSecrets().client_id,
            client_secret: this.secrets.getSecrets().client_secret,
            access_token: this.secrets.getSecrets().client_authorization,
        });
    }

    private async getUserInfo(channels: string[]): Promise<DBUserInfoEntry[]> {
        return new Promise<DBUserInfoEntry[]>((resolve, reject) => {
            this.twitch.getUsers(channels).then(res => {
                let entries: DBUserInfoEntry[] = [];
                res.data.forEach(user => {
                    entries.push({
                        channel_name: user.login,
                        channel_id: user.id,
                        description: user.description,
                    })
                });

                this.log.debug(`Successfully fetched users data from API for ${entries.length} channels.`);
                resolve(entries);
            }).catch(err => {
                this.log.error(`Failed to fetch users data from API. Error: ${err}.`);
                reject(err);
            })
        });
    }

    public async getStreamInfo(channels: string[]): Promise<DBStreamInfoEntry[]> {
        return new Promise<DBStreamInfoEntry[]>((resolve, reject) => {
            this.twitch.getStreams({ channels: channels }).then(res => {
                let entries: DBStreamInfoEntry[] = [];
                let now: Date = new Date();
                res.data.forEach(stream => {
                    entries.push({
                        iteration: Main.currentIteration,
                        channel_name: stream.user_login,
                        category_name: stream.game_name,
                        category_id: stream.game_id,
                        title: stream.title,
                        uptime: Math.round(Math.abs(now.getTime() - new Date(stream.started_at).getTime())),
                        viewer_count: stream.viewer_count,
                        language: stream.language,
                    });
                });

                this.log.debug(`Successfully fetched stream data from API for ${entries.length} channels.`);
                resolve(entries);
            }).catch(err => {
                this.log.error(`Failed to fetch stream data from API. Error: ${err}.`);
                reject(err);
            })
        });
    }

    public async fetchTopStreams(): Promise<DBStreamInfoEntry[]> {
        let config = { // Headers
            headers: {
                'Authorization': `Bearer ${this.secrets.getSecrets().client_authorization}`,
                'Client-ID': `${this.secrets.getSecrets().client_id}`
            }
        };

        let now: Date = new Date();
        let streams: DBStreamInfoEntry[] = [];
        let pagination_token: string = "";
        const max: number = Math.ceil(Config.config.search_depth / 100);
        for (let i = 0; i < max; i++) {
            if(pagination_token == "" && i > 0) return streams;

            // Build API URL
            let url_parts = [ "https://api.twitch.tv/helix/streams?first=100", `&language=${'en'}` ];
            if(pagination_token != "") url_parts.push(`&after=${pagination_token}`);
            const url = url_parts.join("");
            console.log(url);
            try {
                const axios_response = await axios.get(url, config);
                let data = axios_response.data!.data as any[];
                for(let stream of data) {
                    if(Number(stream.viewer_count) > 1000) {
                        this.log.debug(`${stream.user_login} with ${stream.viewer_count} viewers.`);
                        streams.push({
                            iteration: Main.currentIteration,
                            channel_name: stream.user_login,
                            category_name: stream.game_name,
                            category_id: stream.game_id,
                            title: stream.title,
                            uptime: Math.round(Math.abs(now.getTime() - new Date(stream.started_at).getTime())),
                            viewer_count: stream.viewer_count,
                            language: stream.language,
                        });
                    }
                }

                this.log.debug(`So far we've found ${streams.length} channels with >1000 viewers. Position: ${i}/${max}, querying 100 each.`);
                if(axios_response.data.pagination) {
                    const cursor: string = axios_response.data.pagination!.cursor;
                    pagination_token = cursor;
                    this.log.debug(`Found new pagination token, advancing: ${pagination_token}.`);
                } else {
                    this.log.debug(`No pagination cursor found on: ${url}. Stopping search for streams.`);
                    pagination_token = "";
                    break;
                }
            } catch (err) {
                this.log.error(`Failed to fetch top channels. URL: ${url}. Error: ${JSON.stringify(err)}.`);
                return streams;
            }
        }

        return streams;
    }

    private async storeUsersFromFetch(users: DBStreamInfoEntry[]): Promise<void> {
        const users_not_stored: string[] = await Main.database.getUsersNotInDatabase(users.map(user => user.channel_name));
        try {
            const user_info: DBUserInfoEntry[] = await this.getUserInfo(users_not_stored);
            await Main.database.flushUserInfo(user_info);
        } catch (err) {
            this.log.error(`Failed to store users from top streams fetch! Error: ${err}.`);
        }
    }


}

