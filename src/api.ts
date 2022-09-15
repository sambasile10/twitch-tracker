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

    //private twitch: TwitchApi;
    private secrets: Secrets;

    constuctor() {
        //this.init();
    }

    public async init(): Promise<void> {
        this.secrets = new Secrets();
        await this.secrets.init();
    }

    private async getUserInfo(channels: string[]): Promise<DBUserInfoEntry[]> {
        return new Promise<DBUserInfoEntry[]>((resolve, reject) => {
            let config = { // Headers
                headers: {
                    'Authorization': `Bearer ${this.secrets.getSecrets().client_authorization}`,
                    'Client-ID': `${this.secrets.getSecrets().client_id}`
                }
            };
            
            // Build URL
            let url_parts: string[] = [ `https://api.twitch.tv/helix/users` ];
            for(const channel of channels) {
                url_parts.push(url_parts.length == 1 ? `?login=${channel}` : `&login=${channel}`);
            }

            const url: string = url_parts.join("");
            console.log(url);

            axios.get(url, config).then(res => {
                const data = res.data!.data as any[];
                let userData: DBUserInfoEntry[] = [];
                for(const user of data) {
                    userData.push({
                        channel_name: user.login,
                        channel_id: user.id,
                        description: user.description,
                        creation_date: user.created_at,
                    } as DBUserInfoEntry);
                }

                resolve(userData);
            }).catch(err => {
                // Handle fetch error, if the response status is 401 (unauthorized) then fetch a new bearer token
                if(err.response) {
                    this.log.error(`Failed to fetch user data with status: ${err.response!.status}.`);
                } else {
                    this.log.error(`Failed to fetch user data, the server did not give a response. (This likely means the user doesn't exist)`);
                }

                reject(err.response);
            });
        });
    }

    public async fetchTopStreams(): Promise<DBStreamInfoEntry[]> {
        this.log.info(`Fetching top streams from API...`);
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
        this.log.debug(`Starting fetch of data max=${max}`);
        for (let i = 0; i < max; i++) {
            if(pagination_token == "" && i > 0) return streams;

            // Build API URL
            let url_parts = [ "https://api.twitch.tv/helix/streams?first=100", `&language=${'en'}` ];
            if(pagination_token != "") url_parts.push(`&after=${pagination_token}`);
            const url = url_parts.join("");
            //this.log.debug(url);
            try {
                const axios_response = await axios.get(url, config);
                let data = axios_response.data!.data as any[];
                for(let stream of data) {
                    if(Number(stream.viewer_count) > 1000) {
                        //this.log.debug(`${stream.user_login} with ${stream.viewer_count} viewers.`);
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

    public async storeUsersFromFetch(users: DBStreamInfoEntry[]): Promise<void> {
        let user_names: string[]  = [];
        for(const user of users) {
            user_names.push(user.channel_name);
        }

        const users_not_stored: string[] = await Main.database.getUsersNotInDatabase(user_names);
        this.log.debug(`${users_not_stored.length} users not in database, fetching data and flushing...`);
        try {
            // Split users array to chunks of 100 (max for twitch API at once)
            let arrays = [];
            while (users_not_stored.length > 0)
                arrays.push(users_not_stored.splice(0, 100));

            const user_info: DBUserInfoEntry[] = [];
            for await(const users_chunk of arrays) {
                const res: DBUserInfoEntry[] = await this.getUserInfo(users_chunk);
                user_info.push(...res);
            }

            await Main.database.flushUserInfo(user_info);
        } catch (err) {
            this.log.error(`Failed to store users from top streams fetch! Error: ${err}.`);
        }
    }


}

