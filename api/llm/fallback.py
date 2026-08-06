"""Deterministic template briefings — built FIRST, zero network calls."""

from __future__ import annotations

from typing import Any, Literal

from api.schemas import BriefResponse
from api.freshness import SOURCES, build_freshness

Lang = Literal["en", "es", "vi"]

_VERDICT_LINE = {
    "en": {
        "GO": "It is OK to work outside with normal breaks.",
        "CAUTION": "Work outside with care — slow down and rest more.",
        "RESTRICT": "Limit outdoor work. Do only essential tasks.",
        "STOP": "Stop outdoor work now. Move the crew to cool shade indoors.",
    },
    "es": {
        "GO": "Se puede trabajar afuera con descansos normales.",
        "CAUTION": "Trabaje afuera con cuidado — vaya mas despacio y descanse mas.",
        "RESTRICT": "Limite el trabajo afuera. Solo tareas esenciales.",
        "STOP": "Pare el trabajo afuera ahora. Lleve al equipo a la sombra fresca.",
    },
    "vi": {
        "GO": "Co the lam viec ngoai troi voi nghi giai lao binh thuong.",
        "CAUTION": "Lam viec ngoai troi can than — cham lai va nghi nhieu hon.",
        "RESTRICT": "Han che lam viec ngoai troi. Chi viec thiet yeu.",
        "STOP": "Ngung lam viec ngoai troi ngay. Dua to doi vao cho mat.",
    },
}

_ACTIONS = {
    "en": {
        "GO": [
            "Drink water every 20 minutes.",
            "Use the work/rest times on the schedule.",
            "Watch teammates for dizziness or nausea.",
        ],
        "CAUTION": [
            "Take longer shade breaks on the schedule.",
            "Rotate heavy tasks; keep water within reach.",
            "Call a stop if anyone feels faint or confused.",
        ],
        "RESTRICT": [
            "Do only essential outdoor tasks.",
            "Rest in shade or AC between short work blocks.",
            "Have a cool-down plan ready for the crew.",
        ],
        "STOP": [
            "Stop outdoor work and move everyone to cool shade.",
            "Offer cool water; loosen heavy gear.",
            "Seek medical help if someone collapses or stops sweating.",
        ],
    },
    "es": {
        "GO": [
            "Beba agua cada 20 minutos.",
            "Use los tiempos de trabajo y descanso del horario.",
            "Vigile mareo o nausea en el equipo.",
        ],
        "CAUTION": [
            "Tome descansos mas largos a la sombra.",
            "Rote tareas pesadas; tenga agua cerca.",
            "Pare si alguien se siente debil o confundido.",
        ],
        "RESTRICT": [
            "Solo tareas esenciales afuera.",
            "Descanse a la sombra o con aire entre bloques cortos.",
            "Tenga un plan de enfriamiento listo.",
        ],
        "STOP": [
            "Pare el trabajo afuera y lleve a todos a la sombra fresca.",
            "Ofrezca agua fresca; afloje equipo pesado.",
            "Busque ayuda medica si alguien se desmaya o deja de sudar.",
        ],
    },
    "vi": {
        "GO": [
            "Uong nuoc moi 20 phut.",
            "Theo lich lam/nghi tren ung dung.",
            "De y dong doi bi chong mat hoac buon non.",
        ],
        "CAUTION": [
            "Nghi dai hon trong bong mat theo lich.",
            "Xoay viec nang; luon co nuoc gan.",
            "Dung lai neu ai bi yeu hoac lo mo.",
        ],
        "RESTRICT": [
            "Chi lam viec thiet yeu ngoai troi.",
            "Nghi trong bong mat hoac may lanh giua cac kip ngan.",
            "Chuan bi ke hoach lam mat cho to doi.",
        ],
        "STOP": [
            "Ngung viec ngoai troi va dua moi nguoi vao cho mat.",
            "Cho uong nuoc mat; noi long do bao ho nang.",
            "Goi cap cuu neu ai nga hoac ngung to mo hoi.",
        ],
    },
}

_WARNINGS = {
    "en": [
        "Dizziness, headache, or nausea",
        "Confusion or stumbling",
        "Hot dry skin or stopping sweat",
    ],
    "es": [
        "Mareo, dolor de cabeza o nausea",
        "Confusion o tropiezos",
        "Piel caliente y seca o deja de sudar",
    ],
    "vi": [
        "Chong mat, dau dau, hoac buon non",
        "Lo mo hoac loang choang",
        "Da nong kho hoac ngung to mo hoi",
    ],
}


def render_fallback_brief(engine: dict[str, Any], lang: Lang = "en") -> BriefResponse:
    verdict = (
        (engine.get("current") or {}).get("verdict")
        or engine.get("verdict")
        or "CAUTION"
    )
    schedule = engine.get("schedule") or {}
    hard = schedule.get("hard_stop_window")
    best = schedule.get("best_work_window")
    safe = schedule.get("total_safe_hours")

    if lang == "es":
        if hard:
            sched_sentence = f"Pare el trabajo al aire libre entre {hard}. Mejor ventana: {best or 'temprano'}."
        else:
            sched_sentence = f"No hay parada dura hoy. Mejor ventana: {best or 'mañana'}. Horas mas seguras: {safe}."
    elif lang == "vi":
        if hard:
            sched_sentence = f"Ngung lam viec ngoai troi trong khoang {hard}. Thoi diem tot: {best or 'som'}."
        else:
            sched_sentence = f"Khong co khung gio dung bat buoc. Thoi diem tot: {best or 'sang'}. Gio an toan: {safe}."
    else:
        if hard:
            sched_sentence = f"Hard stop outdoor work during {hard}. Best window: {best or 'early morning'}."
        else:
            sched_sentence = (
                f"No hard stop today. Best window: {best or 'morning'}. "
                f"Safer hours: {safe}."
            )

    lines = _VERDICT_LINE.get(lang, _VERDICT_LINE["en"])
    actions = _ACTIONS.get(lang, _ACTIONS["en"])
    warnings = _WARNINGS.get(lang, _WARNINGS["en"])

    return BriefResponse(
        verdict_line=lines.get(verdict, lines["CAUTION"]),
        three_actions=list(actions.get(verdict, actions["CAUTION"])),
        schedule_sentence=sched_sentence,
        warning_signs=list(warnings),
        language=lang,
        used_fallback=True,
        cached=False,
        data_freshness=build_freshness([]),
        sources=SOURCES,
    )
