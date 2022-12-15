# Twitch Tracker

This is the data collection portion of Twitch Tracker, a scraper that tracks what channels users watch on Twitch by fetching the user lists of popular English channels. The user lists are temporarily stored as JSON files until the scraper is ready to compute the intersections for all channels, it is then stored permanently in Postgres. 