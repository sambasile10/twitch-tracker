import { config } from "process";
import { Config } from "./config";
import { Database } from "./database";
import { Scraper } from "./scraper";

let configloader: Config = new Config();

let database: Database = new Database();
database.init();

let scraper: Scraper = new Scraper();


scraper.start(database.writeChatters.bind(database),
              database.flushOverlaps.bind(database));

//scraper.getChattersForChannel('saruei').then(chatters => console.log(chatters));


