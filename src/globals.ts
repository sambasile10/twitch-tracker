import { Overlaps } from "./overlaps";

// Current total chatters, map should be erased every iteration
let currentTotalChatters: Map<string, number> = new Map<string, number>;

let calcOverlaps: Overlaps = new Overlaps();

export { currentTotalChatters, calcOverlaps }