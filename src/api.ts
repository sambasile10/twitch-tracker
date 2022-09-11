import axios from 'axios';

declare interface OAuthTokenData {
    access_token: string,
    expires_in: number,
    token_type: string
};

export class TwitchAPI {

    constuctor() {}

    // Uses config secrets to get a OAuth token
    /*async fetchBearerToken(): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            axios.post(
                `https://id.twitch.tv/oauth2/token?client_id=${ConfigManager.config.client_id}&client_secret=${ConfigManager.config.client_secret}&grant_type=client_credentials`
            ).then(res => {
                let token = res.data.access_token;
                ConfigManager.config.client_authorization = token; // Add new token to config 
                ConfigManager.notifyUpdate(); // Update configuration
                this.log.info(`Successfully fetched new OAuth bearer token from Twitch. It will expire in ${res.data.expires_in} seconds.`);
                resolve(token);
            }).catch(err => {
                this.log.fatal(`Failed to fetch OAuth bearer token with status ${err.response!.status}`);
                reject(err);
            });
        });
    }*/

}

