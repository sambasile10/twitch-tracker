import axios from 'axios';
import { ISettingsParam, Logger } from 'tslog';
import { TSLOG_OPTIONS } from './main';
import { Secrets } from './secrets';

/*
 *  Twitch API users endpoint response
 *  https://dev.twitch.tv/docs/api/reference/#get-users
 */ 
declare interface GetUsersResponse {
    data: UserData[]
}

// Returned user data
declare interface UserData {
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
};

// Broadcast data
declare interface BroadcastData {
    broadcaster_id?: string,
    broadcaster_login?: string,
    broadcaster_name?: string,
    broadcaster_language?: string,
    game_id?: string,
    game_name?: string,
    title?: string,
    delay?: number,
}

export class TwitchAPI {

    private log: Logger = new Logger({ name: "TwitchAPI", ...TSLOG_OPTIONS } as ISettingsParam);

    private secrets: Secrets;

    constuctor() {
        this.secrets = new Secrets();
    }

    // Fetch broadcast data from a max of 100 usernames
    async fetchBroadcastData(channels: string[]): Promise<BroadcastData[]> {
        return new Promise<BroadcastData[]>((resolve, reject) => {
            let config = { // Headers
                headers: {
                    'Authorization': `Bearer ${this.secrets.getSecrets().client_authorization}`,
                    'Client-ID': `${this.secrets.getSecrets().client_id}`
                }
            };

            // Construct URL
            let url: string = "https://api.twitch.tv/helix/channels"
        });
    }

    // Fetch user data from a given username
    async fetchUserData(username: string, fetch_token: boolean): Promise<UserData> {
        return new Promise<UserData>((resolve, reject) => {
            let config = { // Headers
                headers: {
                    'Authorization': `Bearer ${this.secrets.getSecrets().client_authorization}`,
                    'Client-ID': `${this.secrets.getSecrets().client_id}`
                }
            };

            axios.get(
                `https://api.twitch.tv/helix/users?login=${username}`,
                config // Include config
            ).then(res => {
                // Cast GET response to our object, response is returned as array
                let userData: UserData = (res.data!.data as GetUsersResponse)[0];
                this.log.debug(`Fetched user data for '${username}' with user ID: '${userData.id}'`);
                resolve(userData);
            }).catch(err => {
                // Handle fetch error, if the response status is 401 (unauthorized) then fetch a new bearer token
                if(err.response) {
                    this.log.error(`Failed to fetch user data for '${username}' with status: ${err.response!.status}.`);
                } else {
                    this.log.error(`Failed to fetch user data '${username}', the server did not give a response. (This likely means the user doesn't exist)`);
                }

                reject(err.response!.status || -1);
            });
        });
    }

    // Test API connection, returns true if connection works
    async checkAPIConnection(retry_auth: boolean): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            this.fetchUserData('twitch', true) // Try to get user data for 'twitch'
            .then(res => {
                // Successfully fetched data
                this.log.info("Connected to Twitch API successfully.");
                resolve(true);
            }).catch(err => {
                this.log.error("Failed to connect to Twitch API.");

                if(retry_auth) {
                    this.log.info("Fetching new authorization...");
                    this.secrets.renewAuthorization().then(res => {
                        this.log.info("Successfully fetched new authorization.");
                        resolve(true);
                    }).catch(err => {
                        this.log.fatal("Failed to fetch new authorization");
                        resolve(false);
                    })
                } else {
                    resolve(false);
                }
            });
        });
    }

}

