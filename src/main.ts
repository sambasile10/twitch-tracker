import { exit } from "process";
import { TwitchAPI } from "./api";
import { Config } from "./config";
import { Database } from "./database";
import { Scraper } from "./scraper";

const TSLOG_OPTIONS = {
    displayFilePath: "hidden",
    displayFunctionName: false,
};

export { TSLOG_OPTIONS };

let configloader: Config = new Config();

let database: Database = new Database();
database.init();

let api: TwitchAPI = new TwitchAPI();
api.checkAPIConnection(true).then(alive => { if(!alive) exit(1); });

let scraper: Scraper = new Scraper();


scraper.start(database.writeChatters.bind(database),
              database.flushOverlaps.bind(database));

//scraper.getChattersForChannel('saruei').then(chatters => console.log(chatters));

export { scraper }


