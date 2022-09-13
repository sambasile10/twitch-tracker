import { ISettingsParam, Logger } from "tslog";
import { TSLOG_OPTIONS } from "./main";
import { exit } from 'process';
import * as fs from 'fs';
import axios from 'axios';

declare interface APISecrets {
    "client_id": string,
    "client_secret": string,
    "client_authorization": string,
}

const SECRETS_PATH: string = process.env.SECRETS_PATH || '/usr/share/tracker/config/secrets.json';

export class Secrets {

    private log: Logger = new Logger({ name: 'Config', ...TSLOG_OPTIONS } as ISettingsParam);

    private secrets: APISecrets;

    constructor() {
    }

    public async init(): Promise<void> {
        if(!fs.existsSync(SECRETS_PATH)) {
            this.log.fatal(`Secrets file does not exist. Path: ${SECRETS_PATH}`);
            exit(255);
        }

        let rawText = fs.readFileSync(SECRETS_PATH).toString();
        this.secrets = JSON.parse(rawText) as APISecrets;
        this.log.debug(`Read secrets file '${SECRETS_PATH}'.`);

        if(this.secrets.client_authorization === "") {
            this.log.debug("No client authorization, fetching new token...");
            try {
                await this.renewAuthorization();
            } catch (err) {
                exit(1);
            }
        }
    }

    public getSecrets(): APISecrets {
        return this.secrets;
    }

    public async renewAuthorization(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            axios.post(
                `https://id.twitch.tv/oauth2/token?client_id=${this.secrets.client_id}&client_secret=${this.secrets.client_secret}&grant_type=client_credentials`
            ).then(res => {
                let token = res.data.access_token;
                this.secrets.client_authorization = token;
                this.writeSecrets();
                this.log.info(`Successfully fetched new OAuth bearer token from Twitch. It will expire in ${res.data.expires_in} seconds.`);
                resolve();
            }).catch(err => {
                this.log.fatal(`Failed to fetch OAuth bearer token with status ${err.response!.status}`);
                reject(err);
            });
        });
    }

    private async writeSecrets(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            let json_data = JSON.stringify(this.secrets);
            fs.writeFile(SECRETS_PATH, json_data, (err) => {
                if(err) {
                    this.log.warn(`Failed to write secrets to '${SECRETS_PATH}'. Error: ${JSON.stringify(err)}`);
                    reject(err);
                } else {
                    this.log.debug(`Successfully updated secrets.`);
                    resolve();
                }
            });
        });
    }

}