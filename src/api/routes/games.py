"""Game detail endpoints — single game deep-dive for the decision page."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_db
from src.api.schemas import (
    GameDetailResponse,
    GameFeaturesResponse,
    GameMarketsResponse,
    InjuryDetail,
    MarketContractInfo,
    OrderbookData,
    OrderbookLevel,
    PricePoint,
    ProbabilityBreakdown,
    DecisionMetrics,
    ConfidenceInfo,
    KeyDriver,
    RiskFlag,
    FilterGate,
    TeamStats,
)
from src.db.models import (
    Game,
    MarketContract,
    MarketQuote,
    OrderbookSnapshot,
    PlayerInjury,
    Signal,
    SportsbookLine,
    TeamFeature,
)

router = APIRouter()


def _team_stats_from_feature(tf: TeamFeature, is_home: bool) -> TeamStats:
    return TeamStats(
        team_abbr="",  # filled by caller
        off_rating=tf.off_rating or 0,
        def_rating=tf.def_rating or 0,
        net_rating=tf.net_rating or 0,
        pace=tf.pace or 100,
        efg_pct=tf.efg_pct or 0.5,
        ts_pct=tf.ts_pct or 0.54,
        tov_pct=tf.tov_pct or 14,
        orb_pct=tf.orb_pct or 25,
        drb_pct=tf.drb_pct or 75,
        last3_net=tf.last3_net_rating or 0,
        last5_net=tf.last5_net_rating or 0,
        last10_net=tf.last10_net_rating or 0,
        home_net=tf.home_net_rating or 0,
        road_net=tf.road_net_rating or 0,
        elo=tf.elo_rating or 1500,
        win_streak=tf.win_streak or 0,
        rest_days=0,
        is_b2b=False,
        injury_impact=0.0,
    )


def _build_filter_gates(sig: Signal) -> list[FilterGate]:
    """Reconstruct which gates passed/failed from signal data."""
    from src.config import cfg
    thresholds = cfg["thresholds"]
    gates = [
        FilterGate(
            gate_name="Positive Edge",
            threshold="> 0",
            actual_value=f"{sig.edge:.4f}" if sig.edge else "0",
            passed=(sig.edge or 0) > 0,
        ),
        FilterGate(
            gate_name="Min Edge",
            threshold=f">= {thresholds['min_edge']}",
            actual_value=f"{sig.edge:.4f}" if sig.edge else "0",
            passed=(sig.edge or 0) >= thresholds["min_edge"],
        ),
        FilterGate(
            gate_name="Min EV",
            threshold=f">= {thresholds['min_ev']}",
            actual_value=f"{sig.expected_value:.4f}" if sig.expected_value else "0",
            passed=(sig.expected_value or 0) >= thresholds["min_ev"],
        ),
        FilterGate(
            gate_name="Liquidity",
            threshold=">= 0.15",
            actual_value=f"{sig.liquidity_score:.3f}" if sig.liquidity_score else "0",
            passed=(sig.liquidity_score or 0) >= 0.15,
        ),
        FilterGate(
            gate_name="Confidence Score",
            threshold=f">= {thresholds['min_confidence_score']}",
            actual_value=f"{sig.confidence_score:.3f}" if sig.confidence_score else "0",
            passed=(sig.confidence_score or 0) >= thresholds["min_confidence_score"],
        ),
        FilterGate(
            gate_name="Model Agreement",
            threshold=f"<= {thresholds['max_model_disagreement']}",
            actual_value=f"{sig.model_disagreement:.3f}" if sig.model_disagreement else "0",
            passed=(sig.model_disagreement or 0) <= thresholds["max_model_disagreement"],
        ),
        FilterGate(
            gate_name="Injury Uncertainty",
            threshold=f"<= {thresholds['max_injury_uncertainty']}",
            actual_value=f"{sig.injury_uncertainty:.3f}" if sig.injury_uncertainty else "0",
            passed=(sig.injury_uncertainty or 0) <= thresholds["max_injury_uncertainty"],
        ),
        FilterGate(
            gate_name="Time to Game",
            threshold=f"{thresholds['min_time_to_game_hours']}–{thresholds['max_time_to_game_hours']}h",
            actual_value="—",
            passed=True,  # approximate — would need signal_time vs game_time
        ),
        FilterGate(
            gate_name="No HIGH Risk Flags",
            threshold="0 HIGH flags",
            actual_value=str(sum(1 for f in (sig.risk_flags or []) if f.get("severity") == "HIGH")),
            passed=not any(f.get("severity") == "HIGH" for f in (sig.risk_flags or [])),
        ),
    ]
    return gates


@router.get("/games/{game_id}", response_model=GameDetailResponse)
async def game_detail(game_id: str, db: AsyncSession = Depends(get_db)):
    """Full game detail for the decision page. Refresh: every 30s."""
    game = (await db.execute(select(Game).where(Game.game_id == game_id))).scalar()
    if not game:
        raise HTTPException(404, f"Game {game_id} not found")

    # Team features
    home_tf_q = select(TeamFeature).where(
        TeamFeature.game_id == game_id
    ).join(
        Game, Game.game_id == TeamFeature.game_id
    )
    tfs = (await db.execute(home_tf_q)).scalars().all()

    home_stats = away_stats = None
    for tf in tfs:
        from src.db.models import Team
        team = (await db.execute(select(Team).where(Team.team_id == tf.team_id))).scalar()
        if team and team.abbreviation == game.home_team:
            home_stats = _team_stats_from_feature(tf, True)
            home_stats.team_abbr = game.home_team
            home_stats.rest_days = game.home_rest_days or 0
            home_stats.is_b2b = game.is_back_to_back_home or False
        elif team and team.abbreviation == game.away_team:
            away_stats = _team_stats_from_feature(tf, False)
            away_stats.team_abbr = game.away_team
            away_stats.rest_days = game.away_rest_days or 0
            away_stats.is_b2b = game.is_back_to_back_away or False

    if not home_stats:
        home_stats = TeamStats(team_abbr=game.home_team, off_rating=0, def_rating=0,
            net_rating=0, pace=100, efg_pct=0.5, ts_pct=0.54, tov_pct=14,
            orb_pct=25, drb_pct=75, last3_net=0, last5_net=0, last10_net=0,
            home_net=0, road_net=0, elo=1500, win_streak=0, rest_days=0,
            is_b2b=False, injury_impact=0)
    if not away_stats:
        away_stats = TeamStats(team_abbr=game.away_team, off_rating=0, def_rating=0,
            net_rating=0, pace=100, efg_pct=0.5, ts_pct=0.54, tov_pct=14,
            orb_pct=25, drb_pct=75, last3_net=0, last5_net=0, last10_net=0,
            home_net=0, road_net=0, elo=1500, win_streak=0, rest_days=0,
            is_b2b=False, injury_impact=0)

    # Injuries
    inj_q = select(PlayerInjury).where(PlayerInjury.game_id == game_id)
    injuries = (await db.execute(inj_q)).scalars().all()
    home_injuries = [
        InjuryDetail(
            player_name=i.player_name, status=i.status,
            injury_type=i.injury_type, bpm=i.player_bpm or 0,
            usg_pct=i.player_usg_pct or 0.2,
            impact_weight=i.impact_weight or 0,
            is_star=(i.player_bpm or 0) >= 3.0,
        )
        for i in injuries
        if (await db.execute(select(Game).where(Game.game_id == game_id))).scalar()
        and i.team_id == game.home_team_id
    ]
    away_injuries = [
        InjuryDetail(
            player_name=i.player_name, status=i.status,
            injury_type=i.injury_type, bpm=i.player_bpm or 0,
            usg_pct=i.player_usg_pct or 0.2,
            impact_weight=i.impact_weight or 0,
            is_star=(i.player_bpm or 0) >= 3.0,
        )
        for i in injuries if i.team_id == game.away_team_id
    ]

    # Markets
    mkt_q = select(MarketContract).where(MarketContract.game_id == game_id)
    contracts = (await db.execute(mkt_q)).scalars().all()
    markets = []
    for c in contracts:
        # Latest quote
        qq = (
            select(MarketQuote)
            .where(MarketQuote.contract_id == c.contract_id)
            .order_by(MarketQuote.quote_time.desc())
            .limit(1)
        )
        quote = (await db.execute(qq)).scalar()
        markets.append(MarketContractInfo(
            contract_id=str(c.contract_id),
            platform=c.platform,
            market_type=c.market_type,
            question=c.question,
            outcome=c.outcome,
            status=c.status,
            yes_bid=quote.yes_bid if quote else 0,
            yes_ask=quote.yes_ask if quote else 1,
            yes_mid=quote.yes_mid if quote else 0.5,
            spread=quote.spread if quote else 0,
            volume_24h=quote.volume_24h if quote else None,
            open_interest=quote.open_interest if quote else None,
            fee_pct=c.platform_fee_pct or 0.02,
        ))

    # Best signal for this game
    sig_q = (
        select(Signal)
        .where(Signal.game_id == game_id, Signal.is_backtest.is_(False))
        .order_by(Signal.edge.desc())
        .limit(1)
    )
    sig = (await db.execute(sig_q)).scalar()

    probability = None
    decision = None
    confidence = None
    key_drivers = []
    risk_flags = []
    filter_gates = []
    is_actionable = False
    skip_reason = None

    if sig:
        probability = ProbabilityBreakdown(
            sportsbook_novig=sig.sportsbook_novig_prob,
            model_raw=sig.model_prob,
            model_calibrated=sig.calibrated_prob,
            market_mid=sig.market_yes_mid,
            ensemble_fair=sig.ensemble_fair_prob,
            ci_lower=sig.prob_ci_lower,
            ci_upper=sig.prob_ci_upper,
        )
        decision = DecisionMetrics(
            direction=sig.direction or "SKIP",
            edge=sig.edge or 0,
            expected_value=sig.expected_value or 0,
            kelly_full=sig.kelly_full or 0,
            kelly_suggested=sig.suggested_fraction or 0,
            suggested_size_usd=None,
            max_size_usd=None,
        )
        confidence = ConfidenceInfo(
            score=sig.confidence_score or 0,
            tier=sig.confidence_tier or "LOW",
            model_disagreement=sig.model_disagreement or 0,
        )
        key_drivers = [KeyDriver(**d) for d in (sig.key_drivers or [])]
        risk_flags = [RiskFlag(**f) for f in (sig.risk_flags or [])]
        filter_gates = _build_filter_gates(sig)
        is_actionable = sig.direction in ("YES", "NO") and sig.skip_reason is None
        skip_reason = sig.skip_reason

    return GameDetailResponse(
        game_id=game.game_id,
        game_date=game.game_date,
        game_time_utc=game.game_time_utc,
        home_team=game.home_team,
        away_team=game.away_team,
        venue=game.venue,
        season_type=game.season_type,
        series_info=f"Round {game.playoff_round} G{game.series_game_num}" if game.series_game_num else None,
        home_stats=home_stats,
        away_stats=away_stats,
        home_injuries=home_injuries,
        away_injuries=away_injuries,
        markets=markets,
        probability=probability,
        decision=decision,
        confidence=confidence,
        key_drivers=key_drivers,
        risk_flags=risk_flags,
        filter_gates=filter_gates,
        is_actionable=is_actionable,
        skip_reason=skip_reason,
    )


@router.get("/games/{game_id}/markets", response_model=GameMarketsResponse)
async def game_markets(game_id: str, db: AsyncSession = Depends(get_db)):
    """Market contracts, orderbooks, and price history for a game."""
    contracts_q = select(MarketContract).where(MarketContract.game_id == game_id)
    contracts = (await db.execute(contracts_q)).scalars().all()

    market_list = []
    orderbooks = {}
    price_history = {}

    for c in contracts:
        cid = str(c.contract_id)

        # Latest quote
        qq = (
            select(MarketQuote)
            .where(MarketQuote.contract_id == c.contract_id)
            .order_by(MarketQuote.quote_time.desc())
            .limit(1)
        )
        quote = (await db.execute(qq)).scalar()

        market_list.append(MarketContractInfo(
            contract_id=cid, platform=c.platform, market_type=c.market_type,
            question=c.question, outcome=c.outcome, status=c.status,
            yes_bid=quote.yes_bid if quote else 0,
            yes_ask=quote.yes_ask if quote else 1,
            yes_mid=quote.yes_mid if quote else 0.5,
            spread=quote.spread if quote else 0,
            volume_24h=quote.volume_24h if quote else None,
            open_interest=quote.open_interest if quote else None,
            fee_pct=c.platform_fee_pct or 0.02,
        ))

        # Orderbook
        ob_q = (
            select(OrderbookSnapshot)
            .where(OrderbookSnapshot.contract_id == c.contract_id)
            .order_by(OrderbookSnapshot.snapshot_time.desc())
            .limit(1)
        )
        ob = (await db.execute(ob_q)).scalar()
        if ob:
            depth = ob.depth_json or []
            bids = [OrderbookLevel(price=l["price"], size=l["size"]) for l in depth if l.get("side") == "bid"]
            asks = [OrderbookLevel(price=l["price"], size=l["size"]) for l in depth if l.get("side") == "ask"]
            orderbooks[cid] = OrderbookData(
                contract_id=cid,
                snapshot_time=ob.snapshot_time,
                bids=bids, asks=asks,
                best_bid=ob.best_bid or 0,
                best_ask=ob.best_ask or 1,
                depth_3c_bid=ob.depth_3c_bid or 0,
                depth_3c_ask=ob.depth_3c_ask or 0,
                imbalance=ob.imbalance or 0,
            )

        # Price history (last 100 quotes)
        ph_q = (
            select(MarketQuote)
            .where(MarketQuote.contract_id == c.contract_id)
            .order_by(MarketQuote.quote_time.desc())
            .limit(100)
        )
        quotes = (await db.execute(ph_q)).scalars().all()
        price_history[cid] = [
            PricePoint(
                time=q.quote_time, yes_mid=q.yes_mid,
                yes_bid=q.yes_bid, yes_ask=q.yes_ask,
                volume=q.volume_24h,
            )
            for q in reversed(quotes)
        ]

    return GameMarketsResponse(
        game_id=game_id,
        contracts=market_list,
        orderbooks=orderbooks,
        price_history=price_history,
    )


@router.get("/games/{game_id}/features", response_model=GameFeaturesResponse)
async def game_features(game_id: str, db: AsyncSession = Depends(get_db)):
    """Team stats, matchup features, and injury details."""
    game = (await db.execute(select(Game).where(Game.game_id == game_id))).scalar()
    if not game:
        raise HTTPException(404, f"Game {game_id} not found")

    # Delegate to game_detail for stats — simplified here
    detail = await game_detail(game_id, db)

    return GameFeaturesResponse(
        game_id=game_id,
        home_stats=detail.home_stats,
        away_stats=detail.away_stats,
        matchup_features={},  # Would call MatchupFeatures.compute() in production
        home_injuries=detail.home_injuries,
        away_injuries=detail.away_injuries,
        home_injury_impact=detail.home_stats.injury_impact,
        away_injury_impact=detail.away_stats.injury_impact,
        injury_uncertainty=0.0,
    )
