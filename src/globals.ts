import { Overlaps } from "./overlaps";

// Current total chatters, map should be erased every iteration
let currentTotalChatters: Map<string, number> = new Map<string, number>;
let calcOverlaps: Overlaps = new Overlaps();
let currentIteration: number = 0;

export { currentTotalChatters, calcOverlaps, currentIteration }