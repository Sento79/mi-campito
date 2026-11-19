"""Recoge los avisos de tratamientos de cítricos de la Generalitat Valenciana y los guarda en data/avisos-gva.json.

Lo ejecuta cada día la tarea automática de GitHub (.github/workflows/avisos.yml). Sin dependencias externas.
Uso: python scripts/avisos_gva.py [salida.json]
"""
import datetime as dt
import html as H
import json
import os
import re
import sys
import urllib.parse
import urllib.request

URL = "https://portalagrari.gva.es/es/agricultura/avisos-de-tratamientos"
CITRICOS = ["cítric", "citric", "piojo rojo", "cotonet", "delottococcus", "pseudococcus", "dialeurodes", "paraleyrodes",
            "scirtothrips", "aleurocanthus", "aleurothrixus", "mosca blanca", "ceratitis", "mosca de la fruta", "minador",
            "trioza", "gomosis", "phytophthora", "phytophtora", "aonidiella", "informe_semanal", "informe semanal"]
NO = ["almendr", "arroz", "caqui", "cerezo", "ciruel", "olivo", "oliva", "viña", "vina", "pyricularia", "melocot", "níspero", "nispero"]
PROV = [("valencia", "Valencia"), ("castell", "Castellón"), ("alicante", "Alicante"), ("alacant", "Alicante")]


def recoger():
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 (compatible; MiCampito/1.0)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        page = r.read().decode("utf-8", "replace")
    out, vistos = [], set()
    for href, txt in re.findall(r'href="(/documents/[^"]+?\.pdf[^"]*)"[^>]*>(.*?)</a>', page, re.S | re.I):
        href = H.unescape(href)
        nombre = urllib.parse.unquote_plus(href.split("?")[0].split("/")[-2]).rsplit(".pdf", 1)[0]
        txt = re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", txt))).strip()
        clave = (txt + " " + nombre).lower()
        if not any(k in clave for k in CITRICOS) or any(k in clave for k in NO):
            continue
        url = "https://portalagrari.gva.es" + href
        if url in vistos:
            continue
        vistos.add(url)
        m = re.search(r"[?&]t=(\d{12,})", href)
        fecha = dt.datetime.fromtimestamp(int(m.group(1)) / 1000).date().isoformat() if m else dt.date.today().isoformat()
        nom = re.sub(r"^\d+\s+", "", nombre).replace("_", " ").strip()
        titulo = txt if len(txt) >= 30 and not txt.endswith((" de", "(")) else nom
        prov = next((p for k, p in PROV if k in clave), "")
        out.append({"t": titulo[:160], "u": url, "d": fecha, "p": prov})
    out.sort(key=lambda x: x["d"], reverse=True)
    return out


def main():
    dest = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "data", "avisos-gva.json")
    av = recoger()
    if not av:
        print("Sin avisos: no se cambia el archivo")
        return
    viejo = {}
    if os.path.exists(dest):
        with open(dest, encoding="utf-8") as f:
            viejo = json.load(f)
    if viejo.get("av") == av[:40]:
        print("Sin cambios")
        return
    with open(dest, "w", encoding="utf-8") as f:
        json.dump({"upd": dt.datetime.now().isoformat(timespec="minutes"), "src": URL, "av": av[:40]}, f, ensure_ascii=False, indent=0)
    print(f"{len(av)} avisos de cítricos")


if __name__ == "__main__":
    main()
