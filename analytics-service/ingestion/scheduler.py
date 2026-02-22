from apscheduler.schedulers.background import BackgroundScheduler
import asyncio
import logging

logger = logging.getLogger(__name__)


def start_scheduler():
    scheduler = BackgroundScheduler()

    def run_ingestion():
        try:
            from ingestion.hyperliquid import get_leaderboard
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            result = loop.run_until_complete(get_leaderboard())
            logger.info(f"Leaderboard ingestion: {len(result)} entries")
            loop.close()
        except Exception as e:
            logger.error(f"Ingestion error: {e}")

    scheduler.add_job(run_ingestion, "interval", minutes=15)
    scheduler.start()
    logger.info("Scheduler started")
