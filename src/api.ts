import axios from 'axios';
import { ISettingsParam, Logger } from 'tslog';
import { TSLOG_OPTIONS } from './main';
import { Secrets } from './secrets';
import TwitchApi from 'node-twitch';
import { APIStreamResponse } from 'node-twitch/dist/types/responses';
import { Stream } from 'node-twitch/dist/types/objects';
import { DBStreamInfoEntry, DBUserInfoEntry } from './database';
import { currentIteration } from './globals';

// Returned user data
/* declare interface UserData {
    id: string, // User ID
    login?: string,
    display_name?: string,
    type?: string,
    broadcaster_type?: string,
    description?: string,
    profile_image_url?: string,
    offline_image_url?: string,
    view_count?: string,
    email?: string,
    created_at?: string
}; */

export class TwitchAPI {

    private log: Logger = new Logger({ name: "TwitchAPI", ...TSLOG_OPTIONS } as ISettingsParam);

    private twitch: TwitchApi;
    private secrets: Secrets;

    constuctor() {
        //this.init();
    }

    public async init(): Promise<void> {
        this.secrets = new Secrets();
        this.twitch = new TwitchApi({
            client_id: this.secrets.getSecrets().client_id,
            client_secret: this.secrets.getSecrets().client_secret,
            access_token: this.secrets.getSecrets().client_authorization,
        });
    }

    public async getUserInfo(channels: string[]): Promise<DBUserInfoEntry[]> {
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

    public async getBroadcastInfo(channels: string[]): Promise<DBStreamInfoEntry[]> {
        return new Promise<DBStreamInfoEntry[]>((resolve, reject) => {
            this.twitch.getStreams({ channels: channels }).then(res => {
                let entries: DBStreamInfoEntry[] = [];
                let now: Date = new Date();
                res.data.forEach(stream => {
                    entries.push({
                        iteration: currentIteration,
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

}

