import { Database } from "./database";
import { Scraper } from "./scraper";

let scraper: Scraper = new Scraper();
let database: Database = new Database();

scraper.getChattersForChannel('saruei').then(chatters => console.log(chatters));


