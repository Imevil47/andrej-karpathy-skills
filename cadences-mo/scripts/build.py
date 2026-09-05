# -*- coding: utf-8 -*-
"""Build Cadences MO Grattage v2.0 from the audited v1.3 workbook.

Implementation reasoning is in English; every user-facing string is French.
"""
import sys

import openpyxl
from openpyxl.formatting.rule import Rule
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.styles.differential import DifferentialStyle
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.workbook.defined_name import DefinedName

from style import (
    BORDER, FONT_NAME, NAVY, ORANGE, TEAL, CREAM, LIGHT, WHITE, GREY_TXT,
    OK_FILL, OK_TXT, WARN_FILL, WARN_TXT, BAD_FILL, BAD_TXT,
    NEUTRAL_FILL, NEUTRAL_TXT,
    FMT_DATE, FMT_TIME, FMT_INT, FMT_DEC, FMT_PCT, FMT_KG, FMT_GAP,
    title, section, note, headers, input_cell, calc_cell, label_cell,
    band_cell, widths, rows_height,
)

# ---------------------------------------------------------------------------
# Sizing constants: pre-filled formula rows vs. the ranges aggregations scan.
# Aggregation ranges run past the pre-filled block so the tables can grow
# without any summary sheet needing to be re-pointed.
# ---------------------------------------------------------------------------
BASE_HDR = 3
BASE_FIRST = 4
BASE_FILLED = 2003         # pre-filled formula rows
BASE_SCAN = 50003          # rows scanned by every summary formula
# Rows a per-row backward lookup scans. Bounded so the cost of the
# previous-control and duplicate columns stays linear in the number of rows;
# 900 rows is well over a full day of controls (8 lines x 13 women x 8 tours).
LOOKBACK = 900

RUNS_HDR = 5
RUNS_FIRST = 6
RUNS_FILLED = 205
RUNS_SCAN = 1005

LIST_HDR = 15
LIST_FIRST = 16
LIST_LAST = 37

STD_HDR = 42
STD_FIRST = 43
STD_LAST = 342

EMP_HDR = 346
EMP_FIRST = 347
EMP_LAST = 646

SAISIE_FIRST = 13
SAISIE_LAST = 28           # 16 employees per line and per tour
TRANSFER_FIRST = 37

RECH_HDR = 16
RECH_FIRST = 17
RECH_LAST = 66

TEST_HDR = 3
TEST_FIRST = 4
TEST_LAST = 203

ARRET_HDR = 3
ARRET_FIRST = 4
ARRET_LAST = 203

# Reference data. Values known from v1.3 are migrated; dimensions the plant
# has not published yet are left empty for PARAMETRES to be completed.
LIGNES = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"]
ESPECES = ["SARDINE", "MAQUEREAU"]
PRODUITS = ["FMHT", "SPSA HO", "SPSA HOEV BIO", "FMHOEV BIO"]
MARQUES = []
FORMATS = []
PREPARATIONS = ["HG", "HGT"]
MOULES = []
ACTIVITES = ["GRATTAGE", "REMPLISSAGE", "GRATTAGE + REMPLISSAGE", "INACTIVE"]
TOURS = ["TOUR %02d" % i for i in range(1, 13)]
MOTIFS = [
    "PAUSE", "MANQUE MATIERE", "PANNE", "ATTENTE CUISSON", "ATTENTE QUALITE",
    "NETTOYAGE", "CHANGEMENT PRODUIT", "ORGANISATION", "CHANGEMENT DE LOT",
    "REGLAGE MACHINE", "MANQUE DE PERSONNEL", "COUPURE ELECTRICITE",
    "MANQUE EMBALLAGE", "EVACUATION DECHETS", "AUTRE",
]
TYPES_TEST = ["TEST INDIVIDUEL", "TEST COMPARATIF", "TEST FORMATION", "TEST QUALITE"]
STATUTS_RUN = ["ACTIF", "CLOTURE", "ANNULE"]
OUI_NON = ["OUI", "NON"]

LIST_COLUMNS = [
    ("A", "LIGNE", "T_LIGNES", "ListeLignes", LIGNES, 12),
    ("B", "ESPÈCE", "T_ESPECES", "ListeEspeces", ESPECES, 16),
    ("C", "PRODUIT", "T_PRODUITS", "ListeProduits", PRODUITS, 18),
    ("D", "MARQUE", "T_MARQUES", "ListeMarques", MARQUES, 18),
    ("E", "FORMAT", "T_FORMATS", "ListeFormats", FORMATS, 16),
    ("F", "PRÉPARATION", "T_PREPARATIONS", "ListePreparations", PREPARATIONS, 15),
    ("G", "MOULE", "T_MOULES", "ListeMoules", MOULES, 16),
    ("H", "ACTIVITÉ", "T_ACTIVITES", "ListeActivites", ACTIVITES, 25),
    ("I", "TOUR", "T_TOURS", "ListeTours", TOURS, 12),
    ("J", "MOTIF ARRÊT", "T_MOTIFS", "ListeMotifs", MOTIFS, 25),
    ("K", "TYPE DE TEST", "T_TYPES_TEST", "ListeTypesTest", TYPES_TEST, 19),
    ("L", "STATUT RUN", "T_STATUTS_RUN", "ListeStatutsRun", STATUTS_RUN, 14),
    ("M", "OUI / NON", "T_OUI_NON", "ListeOuiNon", OUI_NON, 12),
]

# Absolute ranges of BASE CONTROLES, used by every summary sheet.
B = "'BASE CONTROLES'!"


def col(letter):
    return "%s$%s$%d:$%s$%d" % (B, letter, BASE_FIRST, letter, BASE_SCAN)


BDATE, BHEURE, BRUN, BTOUR = col("B"), col("C"), col("D"), col("E")
BLIGNE, BMAT, BBOITES, BEFF = col("F"), col("G"), col("H"), col("I")
BACTIV, BPRODUIT, BMARQUE, BFORMAT = col("K"), col("M"), col("N"), col("O")
BPREP, BMOULE, BSTD = col("P"), col("Q"), col("R")
BDUREE, BCADENCE, BATTEINTE, BSTATUT, BVALIDE = (
    col("T"), col("U"), col("V"), col("W"), col("X"))


def add_table(ws, name, ref, style="TableStyleLight9"):
    t = Table(displayName=name, ref=ref)
    t.tableStyleInfo = TableStyleInfo(
        name=style, showFirstColumn=False, showLastColumn=False,
        showRowStripes=False, showColumnStripes=False)
    ws.add_table(t)
    return t


def dv(ws, ref_ranges, formula1, dv_type="list", operator=None, formula2=None,
       error_title=None, error=None):
    rule = DataValidation(
        type=dv_type, formula1=formula1, formula2=formula2, operator=operator,
        allow_blank=True, showErrorMessage=True)
    rule.errorTitle = error_title or "SAISIE REFUSEE"
    rule.error = error or "Valeur non autorisee. Choisir une valeur proposee dans la liste."
    ws.add_data_validation(rule)
    for r in ref_ranges:
        rule.add(r)
    return rule


def cf(ws, ref, formula, fill=None, font_colour=None, bold=False, italic=False):
    style = DifferentialStyle(
        fill=PatternFill(bgColor=fill) if fill else None,
        font=Font(color=font_colour, bold=bold, italic=italic) if font_colour else None)
    ws.conditional_formatting.add(
        ref, Rule(type="expression", formula=[formula], dxf=style, stopIfTrue=False))


# ---------------------------------------------------------------------------
# PARAMETRES — single source of configurable master data.
# ---------------------------------------------------------------------------
def build_parametres(ws):
    widths(ws, {"A": 20, "B": 30, "C": 20, "D": 18, "E": 18, "F": 16, "G": 16,
                "H": 24, "I": 14, "J": 42, "K": 19, "L": 14, "M": 12})

    title(ws, "A1:M1", "PARAMETRES — CADENCES MO")
    note(ws, "A2:M2",
         "Feuille de reference unique. Completer les listes ci-dessous AVANT "
         "de creer un RUN. Les cellules creme sont les seules a saisir.")

    section(ws, "A3:M3", "SEUILS ET LIBELLES DE PERFORMANCE (CONFIGURABLES)")
    headers(ws, 4, 1, ["PARAMÈTRE", "VALEUR", "COMMENTAIRE"])
    seuils = [
        ("SEUIL CONFORME (% DU STANDARD)", 1.0, FMT_PCT,
         "ATTEINTE >= CE SEUIL : STATUT CONFORME"),
        ("SEUIL A SURVEILLER (% DU STANDARD)", 0.9, FMT_PCT,
         "ATTEINTE >= CE SEUIL ET < SEUIL CONFORME : STATUT A SURVEILLER "
         "(valeur reprise de la version 1.3)"),
        ("LIBELLE STATUT CONFORME", "CONFORME", "General", ""),
        ("LIBELLE STATUT INTERMEDIAIRE", "A SURVEILLER", "General", ""),
        ("LIBELLE STATUT INSUFFISANT", "SOUS STANDARD", "General", ""),
        ("LIBELLE STATUT PREMIER CONTROLE", "CONTROLE INITIAL", "General",
         "Premier controle du matricule : aucune duree mesuree, pas de cadence"),
        ("LIBELLE STATUT STANDARD ABSENT", "STANDARD MANQUANT", "General",
         "Aucune ligne active de la table STANDARDS ne correspond a la configuration"),
        ("LIBELLE STATUT DOUBLON", "DOUBLON", "General",
         "Matricule deja controle sur le meme RUN + TOUR + LIGNE"),
    ]
    for i, (lib, val, fmt, com) in enumerate(seuils):
        r = 5 + i
        c = ws.cell(r, 1, lib)
        c.font = Font(name=FONT_NAME, size=10, bold=True, color=NAVY)
        c.alignment = Alignment(horizontal="left", vertical="center", indent=1)
        c.fill = PatternFill("solid", fgColor=LIGHT)
        c.border = BORDER
        cell = input_cell(ws, "B%d" % r, fmt)
        cell.value = val
        cc = ws.cell(r, 3, com)
        cc.font = Font(name=FONT_NAME, size=9, italic=True, color=GREY_TXT)
        cc.alignment = Alignment(horizontal="left", vertical="center",
                                 wrap_text=True, indent=1)
    ws.merge_cells("C5:M5")
    for r in range(6, 13):
        ws.merge_cells("C%d:M%d" % (r, r))
    rows_height(ws, 5, 12, 18)

    section(ws, "A14:M14", "LISTES DE REFERENCE")
    for letter, header, table, _name, values, _w in LIST_COLUMNS:
        headers(ws, LIST_HDR, openpyxl.utils.column_index_from_string(letter), [header])
        for i in range(LIST_FIRST, LIST_LAST + 1):
            c = input_cell(ws, "%s%d" % (letter, i), "General")
            idx = i - LIST_FIRST
            if idx < len(values):
                c.value = values[idx]
        add_table(ws, table, "%s%d:%s%d" % (letter, LIST_HDR, letter, LIST_LAST))
    rows_height(ws, LIST_FIRST, LIST_LAST, 15)

    section(ws, "A%d:M%d" % (STD_HDR - 2, STD_HDR - 2), "STANDARDS DE CADENCE")
    note(ws, "A%d:M%d" % (STD_HDR - 1, STD_HDR - 1),
         "Une ligne = une configuration de production. Laisser vide une dimension "
         "non applicable (ex. MOULE pour la sardine). Seules les lignes ACTIF = OUI "
         "sont utilisees. Le standard repris de la version 1.3 est a confirmer.")
    headers(ws, STD_HDR, 1, [
        "ESPÈCE", "PRODUIT", "MARQUE", "FORMAT", "PRÉPARATION", "MOULE",
        "ACTIVITÉ", "STANDARD BOITES/H/FEMME", "ACTIF", "CLÉ (CALCULÉE)"])
    for r in range(STD_FIRST, STD_LAST + 1):
        for letter in "ABCDEFG":
            input_cell(ws, "%s%d" % (letter, r), "General",
                       align="left" if letter in "ABCD" else "center")
        input_cell(ws, "H%d" % r, FMT_DEC)
        input_cell(ws, "I%d" % r, "General")
        c = calc_cell(ws, "J%d" % r, "General", align="left")
        c.font = Font(name=FONT_NAME, size=9, color=GREY_TXT)
        c.value = ("=IF(OR($A{r}=\"\",$I{r}<>\"OUI\"),\"\","
                   "$A{r}&\"|\"&$B{r}&\"|\"&$C{r}&\"|\"&$D{r}&\"|\"&$E{r}"
                   "&\"|\"&$F{r}&\"|\"&$G{r})").format(r=r)
    # Standard migrated from v1.3 (PARAMETRES!B5 = 112 for FMHOEV BIO).
    ws["A%d" % STD_FIRST] = "SARDINE"
    ws["B%d" % STD_FIRST] = "FMHOEV BIO"
    ws["G%d" % STD_FIRST] = "GRATTAGE + REMPLISSAGE"
    ws["H%d" % STD_FIRST] = 112
    ws["I%d" % STD_FIRST] = "OUI"
    add_table(ws, "T_STANDARDS", "A%d:J%d" % (STD_HDR, STD_LAST))
    rows_height(ws, STD_FIRST, STD_LAST, 15)

    section(ws, "A%d:M%d" % (EMP_HDR - 1, EMP_HDR - 1), "EMPLOYES")
    headers(ws, EMP_HDR, 1, ["MATRICULE", "NOM ET PRENOM", "ACTIF"])
    for r in range(EMP_FIRST, EMP_LAST + 1):
        input_cell(ws, "A%d" % r, "@")
        input_cell(ws, "B%d" % r, "General", align="left")
        input_cell(ws, "C%d" % r, "General")
    add_table(ws, "T_EMPLOYES", "A%d:C%d" % (EMP_HDR, EMP_LAST))
    rows_height(ws, EMP_FIRST, EMP_LAST, 15)

    dv(ws, ["I%d:I%d" % (STD_FIRST, STD_LAST), "C%d:C%d" % (EMP_FIRST, EMP_LAST)],
       "=ListeOuiNon")
    dv(ws, ["A%d:A%d" % (STD_FIRST, STD_LAST)], "=ListeEspeces")
    dv(ws, ["B%d:B%d" % (STD_FIRST, STD_LAST)], "=ListeProduits")
    dv(ws, ["C%d:C%d" % (STD_FIRST, STD_LAST)], "=ListeMarques")
    dv(ws, ["D%d:D%d" % (STD_FIRST, STD_LAST)], "=ListeFormats")
    dv(ws, ["E%d:E%d" % (STD_FIRST, STD_LAST)], "=ListePreparations")
    dv(ws, ["F%d:F%d" % (STD_FIRST, STD_LAST)], "=ListeMoules")
    dv(ws, ["G%d:G%d" % (STD_FIRST, STD_LAST)], "=ListeActivites")
    dv(ws, ["H%d:H%d" % (STD_FIRST, STD_LAST)], "0", dv_type="decimal",
       operator="greaterThan",
       error_title="STANDARD INVALIDE",
       error="Le standard doit etre un nombre strictement positif (boites/h/femme).")

    ws.freeze_panes = "A5"
    ws.sheet_properties.tabColor = GREY_TXT


R = "RUNS!"
RUN_ID = "%s$A$%d:$A$%d" % (R, RUNS_FIRST, RUNS_SCAN)
STD_KEY = "PARAMETRES!$J$%d:$J$%d" % (STD_FIRST, STD_LAST)
STD_VAL = "PARAMETRES!$H$%d:$H$%d" % (STD_FIRST, STD_LAST)


def blank_safe(index_expr):
    """INDEX over an empty cell yields 0, which would poison lookup keys and
    displays. Map an empty source cell to an empty string instead."""
    return "IFERROR(IF(%s=\"\",\"\",%s),\"\")" % (index_expr, index_expr)


def run_field(letter, id_ref):
    """INDEX/MATCH of one RUNS column for the run identified by `id_ref`."""
    return blank_safe("INDEX(%s$%s$%d:$%s$%d,MATCH(%s,%s,0))"
                      % (R, letter, RUNS_FIRST, letter, RUNS_SCAN, id_ref, RUN_ID))


def run_activite(id_ref, ligne_ref):
    return blank_safe(
        "INDEX(%s$L$%d:$S$%d,MATCH(%s,%s,0),MATCH(\"ACTIVITÉ \"&%s,%s$L$%d:$S$%d,0))"
        % (R, RUNS_FIRST, RUNS_SCAN, id_ref, RUN_ID,
           ligne_ref, R, RUNS_HDR, RUNS_HDR))


def std_lookup(espece, produit, marque, fmt, prep, moule, activite):
    key = "&\"|\"&".join([espece, produit, marque, fmt, prep, moule, activite])
    return blank_safe("INDEX(%s,MATCH(%s,%s,0))" % (STD_VAL, key, STD_KEY))


# ---------------------------------------------------------------------------
# RUNS — production context. One row = one production run.
# ---------------------------------------------------------------------------
def build_runs(ws):
    widths(ws, {"A": 24, "B": 12, "C": 13, "D": 13, "E": 15, "F": 17, "G": 16,
                "H": 15, "I": 15, "J": 14, "K": 15, "T": 13, "U": 26})
    for i, letter in enumerate("LMNOPQRS"):
        ws.column_dimensions[letter].width = 15

    title(ws, "A1:U1", "RUNS — CONTEXTE DE PRODUCTION")
    note(ws, "A2:U2",
         "Un RUN = une configuration de production. L'activite de chaque ligne "
         "(L1 a L8) appartient au RUN : elle n'est jamais figee. Saisir un ID RUN "
         "unique et stable (ex. RUN-20260905-01) : il relie tout l'historique.")
    section(ws, "A4:U4", "LISTE DES RUNS")
    headers(ws, RUNS_HDR, 1, [
        "ID RUN", "DATE", "HEURE DEBUT", "HEURE FIN", "ESPÈCE", "PRODUIT",
        "MARQUE", "FORMAT", "LOT MP", "PRÉPARATION", "MOULE",
        "ACTIVITÉ L1", "ACTIVITÉ L2", "ACTIVITÉ L3", "ACTIVITÉ L4",
        "ACTIVITÉ L5", "ACTIVITÉ L6", "ACTIVITÉ L7", "ACTIVITÉ L8",
        "STATUT RUN", "CONTRÔLE DE COHÉRENCE"])

    for r in range(RUNS_FIRST, RUNS_FILLED + 1):
        input_cell(ws, "A%d" % r, "@", align="left")
        input_cell(ws, "B%d" % r, FMT_DATE)
        input_cell(ws, "C%d" % r, FMT_TIME)
        input_cell(ws, "D%d" % r, FMT_TIME)
        for letter in "EFGHIJK":
            input_cell(ws, "%s%d" % (letter, r), "General",
                       align="left" if letter in "FGI" else "center")
        for letter in "LMNOPQRS":
            input_cell(ws, "%s%d" % (letter, r), "General")
        input_cell(ws, "T%d" % r, "General")
        c = calc_cell(ws, "U%d" % r, "General", align="left")
        c.value = (
            "=IF($A{r}=\"\",\"\","
            "IF(COUNTIF({ids},$A{r})>1,\"ID RUN EN DOUBLON\","
            "IF($B{r}=\"\",\"DATE MANQUANTE\","
            "IF($E{r}=\"\",\"ESPECE MANQUANTE\","
            "IF($F{r}=\"\",\"PRODUIT MANQUANT\","
            "IF($T{r}=\"\",\"STATUT RUN MANQUANT\","
            "IF(COUNTIF($L{r}:$S{r},\"INACTIVE\")=8,\"AUCUNE LIGNE ACTIVE\","
            "\"RUN VALIDE\")))))))").format(r=r, ids=RUN_ID)
    add_table(ws, "T_RUNS", "A%d:U%d" % (RUNS_HDR, RUNS_FILLED))
    rows_height(ws, RUNS_FIRST, RUNS_FILLED, 16)

    last = RUNS_FILLED
    dv(ws, ["E%d:E%d" % (RUNS_FIRST, last)], "=ListeEspeces")
    dv(ws, ["F%d:F%d" % (RUNS_FIRST, last)], "=ListeProduits")
    dv(ws, ["G%d:G%d" % (RUNS_FIRST, last)], "=ListeMarques")
    dv(ws, ["H%d:H%d" % (RUNS_FIRST, last)], "=ListeFormats")
    dv(ws, ["J%d:J%d" % (RUNS_FIRST, last)], "=ListePreparations")
    dv(ws, ["K%d:K%d" % (RUNS_FIRST, last)], "=ListeMoules")
    dv(ws, ["L%d:S%d" % (RUNS_FIRST, last)], "=ListeActivites")
    dv(ws, ["T%d:T%d" % (RUNS_FIRST, last)], "=ListeStatutsRun")

    zone = "T%d:T%d" % (RUNS_FIRST, last)
    cf(ws, zone, '=$T%d="ACTIF"' % RUNS_FIRST, fill=OK_FILL, font_colour=OK_TXT, bold=True)
    cf(ws, zone, '=$T%d="CLOTURE"' % RUNS_FIRST, fill=NEUTRAL_FILL, font_colour=NEUTRAL_TXT)
    cf(ws, zone, '=$T%d="ANNULE"' % RUNS_FIRST, fill=BAD_FILL, font_colour=BAD_TXT)
    cf(ws, "U%d:U%d" % (RUNS_FIRST, last),
       '=AND($U%d<>"",$U%d<>"RUN VALIDE")' % (RUNS_FIRST, RUNS_FIRST),
       fill=BAD_FILL, font_colour=BAD_TXT, bold=True)

    ws.freeze_panes = "B6"
    ws.sheet_properties.tabColor = NAVY


# ---------------------------------------------------------------------------
# SAISIE CONTROLE — the only sheet the controller uses on the floor.
# ---------------------------------------------------------------------------
def build_saisie(ws):
    widths(ws, {"A": 6, "B": 20, "C": 30, "D": 14, "E": 30, "F": 26,
                "G": 18, "H": 22, "I": 16})

    title(ws, "A1:I1", "SAISIE CONTROLE — TERRAIN")
    note(ws, "A2:I2",
         "1. Choisir RUN / TOUR / LIGNE   2. Saisir HEURE DU CONTROLE et EFFECTIF "
         "PRESENT   3. Saisir MATRICULE + NB BOITES pour chaque femme   "
         "4. Copier le bloc de transfert vers BASE CONTROLES (collage special : valeurs).")

    section(ws, "A3:I3", "CONTEXTE")
    saisie_labels = [
        (4, "RUN ACTIF"), (5, "TOUR"), (6, "LIGNE"),
        (7, "HEURE DU CONTROLE"), (8, "EFFECTIF PRESENT"),
    ]
    for r, lab in saisie_labels:
        label_cell(ws, "B%d" % r, lab)
    input_cell(ws, "C4", "General")
    input_cell(ws, "C5", "General")
    input_cell(ws, "C6", "General")
    input_cell(ws, "C7", FMT_TIME)
    input_cell(ws, "C8", FMT_INT)

    run_id = "$C$4"
    derived = [
        (4, "E", "DATE DU RUN", "F", run_field("B", run_id), FMT_DATE),
        (5, "E", "PRODUIT", "F", run_field("F", run_id), "General"),
        (6, "E", "MARQUE", "F", run_field("G", run_id), "General"),
        (7, "E", "FORMAT", "F", run_field("H", run_id), "General"),
        (4, "G", "ESPÈCE", "H", run_field("E", run_id), "General"),
        (5, "G", "PRÉPARATION", "H", run_field("J", run_id), "General"),
        (6, "G", "MOULE", "H", run_field("K", run_id), "General"),
        (7, "G", "ACTIVITÉ LIGNE", "H", run_activite(run_id, "$C$6"), "General"),
    ]
    for r, lcol, lab, vcol, expr, fmt in derived:
        label_cell(ws, "%s%d" % (lcol, r), lab)
        c = calc_cell(ws, "%s%d" % (vcol, r), fmt, bold=True)
        c.value = '=IF(%s="","",%s)' % (run_id, expr)

    label_cell(ws, "E8", "CONFIGURATION")
    c = calc_cell(ws, "F8", "General", bold=True)
    c.value = ('=IF($C$4="","",_xlfn.TEXTJOIN(" / ",TRUE,$H$4,$F$5,$F$6,$F$7,'
               '$H$5,$H$6,$H$7))')
    label_cell(ws, "G8", "STANDARD")
    c = calc_cell(ws, "H8", FMT_DEC, bold=True)
    c.value = '=IF(OR($C$4="",$C$6=""),"",%s)' % std_lookup(
        "$H$4", "$F$5", "$F$6", "$F$7", "$H$5", "$H$6", "$H$7")

    label_cell(ws, "B9", "ETAT DU CONTEXTE")
    ws.merge_cells("C9:I9")
    c = calc_cell(ws, "C9", "General", align="left", bold=True)
    c.value = (
        '=IF($C$4="","SELECTIONNER UN RUN",'
        'IF(%s<>"ACTIF","ATTENTION : RUN NON ACTIF",'
        'IF($C$5="","SELECTIONNER UN TOUR",'
        'IF($C$6="","SELECTIONNER UNE LIGNE",'
        'IF($C$7="","SAISIR L\'HEURE DU CONTROLE",'
        'IF($C$8="","SAISIR L\'EFFECTIF PRESENT",'
        'IF($H$7="INACTIVE","ATTENTION : LIGNE INACTIVE SUR CE RUN",'
        'IF($H$7="","ATTENTION : ACTIVITE NON DEFINIE POUR CETTE LIGNE",'
        'IF($H$8="","ATTENTION : STANDARD MANQUANT POUR CETTE CONFIGURATION",'
        '"CONTEXTE COMPLET — SAISIE POSSIBLE")))))))))' % run_field("T", run_id))
    rows_height(ws, 4, 9, 21)

    section(ws, "A11:I11", "SAISIE DES CONTROLES — MATRICULE + NB BOITES")
    headers(ws, 12, 1, ["N°", "MATRICULE", "NOM ET PRENOM", "NB BOÎTES",
                        "STATUT SAISIE"], colour=TEAL)
    for r in range(SAISIE_FIRST, SAISIE_LAST + 1):
        n = band_cell(ws, "A%d" % r, FMT_INT)
        n.value = r - SAISIE_FIRST + 1
        input_cell(ws, "B%d" % r, "@")
        c = calc_cell(ws, "C%d" % r, "General", align="left")
        c.value = ('=IF($B{r}="","",IFERROR(INDEX(NomsEmployes,'
                   'MATCH($B{r},MatriculesEmployes,0)),"MATRICULE INCONNU"))').format(r=r)
        input_cell(ws, "D%d" % r, FMT_INT)
        c = calc_cell(ws, "E%d" % r, "General", bold=True)
        c.value = (
            '=IF($B{r}="","",'
            'IF(ISNA(MATCH($B{r},MatriculesEmployes,0)),"MATRICULE INCONNU",'
            'IF(COUNTIF($B${f}:$B{r},$B{r})>1,"MATRICULE DEJA CONTROLE",'
            'IF(COUNTIFS({brun},$C$4,{btour},$C$5,{bligne},$C$6,{bmat},$B{r})>0,'
            '"MATRICULE DEJA CONTROLE",'
            'IF($D{r}="","SAISIR NB BOITES",'
            'IF($D{r}<=0,"NB BOITES INVALIDE","SAISIE VALIDE"))))))').format(
                r=r, f=SAISIE_FIRST, brun=BRUN, btour=BTOUR, bligne=BLIGNE, bmat=BMAT)
    rows_height(ws, SAISIE_FIRST, SAISIE_LAST, 20)

    grid = "$E$%d:$E$%d" % (SAISIE_FIRST, SAISIE_LAST)
    section(ws, "A30:I30", "AVANCEMENT DU CONTROLE DE LA LIGNE")
    headers(ws, 31, 2, ["FEMMES CONTROLEES", "EFFECTIF PRESENT", "COUVERTURE %",
                        "AVANCEMENT", "TOTAL BOITES CONTROLEES"], colour=TEAL)
    vals = [
        ("B32", FMT_INT, '=COUNTIF(%s,"SAISIE VALIDE")' % grid),
        ("C32", FMT_INT, '=IF($C$8="","",$C$8)'),
        ("D32", FMT_PCT, '=IF(OR($C$8="",$C$8=0),"",$B$32/$C$8)'),
        ("E32", "General",
         '=IF($C$8="","",$B$32&" / "&$C$8&IF($B$32>=$C$8," — COMPLET",""))'),
        ("F32", FMT_INT,
         '=SUMIF(%s,"SAISIE VALIDE",$D$%d:$D$%d)' % (grid, SAISIE_FIRST, SAISIE_LAST)),
    ]
    for coord, fmt, formula in vals:
        c = calc_cell(ws, coord, fmt, bold=True)
        c.value = formula
    ws.row_dimensions[32].height = 22

    t_last = TRANSFER_FIRST + (SAISIE_LAST - SAISIE_FIRST)
    section(ws, "A34:I34", "LIGNES A COPIER DANS BASE CONTROLES")
    note(ws, "A35:I35",
         "Selectionner la plage B%d:I%d, Copier, puis dans BASE CONTROLES : "
         "clic sur la premiere cellule vide de la colonne DATE > Collage special > "
         "Valeurs. Les colonnes calculees se remplissent seules." % (TRANSFER_FIRST, t_last))
    headers(ws, TRANSFER_FIRST - 1, 2, [
        "DATE", "HEURE", "ID RUN", "TOUR", "LIGNE", "MATRICULE", "NB BOÎTES",
        "EFFECTIF LIGNE"], colour=TEAL)
    tfields = [("B", "$F$4", FMT_DATE), ("C", "$C$7", FMT_TIME),
               ("D", "$C$4", "General"), ("E", "$C$5", "General"),
               ("F", "$C$6", "General"), ("G", None, "@"),
               ("H", None, FMT_INT), ("I", "$C$8", FMT_INT)]
    for i in range(SAISIE_LAST - SAISIE_FIRST + 1):
        src = SAISIE_FIRST + i
        dst = TRANSFER_FIRST + i
        for letter, ref, fmt in tfields:
            c = band_cell(ws, "%s%d" % (letter, dst), fmt, bold=False)
            if ref is None:
                ref = ("$B%d" % src) if letter == "G" else ("$D%d" % src)
            c.value = '=IF($E%d<>"SAISIE VALIDE","",%s)' % (src, ref)
    rows_height(ws, TRANSFER_FIRST, t_last, 15)

    ws.merge_cells("B%d:I%d" % (t_last + 2, t_last + 2))
    c = calc_cell(ws, "B%d" % (t_last + 2), "General", align="left", bold=True)
    c.value = ('="A COPIER : "&$B$32&" LIGNE(S) VALIDE(S) — PLAGE B%d:I%d"'
               % (TRANSFER_FIRST, t_last))

    dv(ws, ["C4"], "=ListeRuns")
    dv(ws, ["C5"], "=ListeTours")
    dv(ws, ["C6"], "=ListeLignes")
    dv(ws, ["C8"], "1", dv_type="whole", operator="greaterThan",
       error_title="EFFECTIF INVALIDE",
       error="L'effectif present doit etre un nombre entier superieur a 1.")
    dv(ws, ["B%d:B%d" % (SAISIE_FIRST, SAISIE_LAST)], "=ListeMatricules",
       error_title="MATRICULE INCONNU",
       error="Ce matricule n'existe pas dans PARAMETRES. L'ajouter d'abord dans la table EMPLOYES.")
    dv(ws, ["D%d:D%d" % (SAISIE_FIRST, SAISIE_LAST)], "0", dv_type="whole",
       operator="greaterThan", error_title="NB BOITES INVALIDE",
       error="Le nombre de boites doit etre un entier strictement positif.")

    zone = "E%d:E%d" % (SAISIE_FIRST, SAISIE_LAST)
    cf(ws, zone, '=$E%d="SAISIE VALIDE"' % SAISIE_FIRST, fill=OK_FILL,
       font_colour=OK_TXT, bold=True)
    cf(ws, zone, '=$E%d="MATRICULE DEJA CONTROLE"' % SAISIE_FIRST, fill=BAD_FILL,
       font_colour=BAD_TXT, bold=True)
    cf(ws, zone, '=$E%d="MATRICULE INCONNU"' % SAISIE_FIRST, fill=BAD_FILL,
       font_colour=BAD_TXT, bold=True)
    cf(ws, zone, '=OR($E%d="SAISIR NB BOITES",$E%d="NB BOITES INVALIDE")'
       % (SAISIE_FIRST, SAISIE_FIRST), fill=WARN_FILL, font_colour=WARN_TXT)
    cf(ws, "C9:I9", '=LEFT($C$9,10)="ATTENTION "', fill=WARN_FILL, font_colour=WARN_TXT)
    cf(ws, "C9:I9", '=$C$9="CONTEXTE COMPLET — SAISIE POSSIBLE"', fill=OK_FILL,
       font_colour=OK_TXT)
    cf(ws, "D32", '=AND($D$32<>"",$D$32>=1)', fill=OK_FILL, font_colour=OK_TXT)
    cf(ws, "D32", '=AND($D$32<>"",$D$32<1)', fill=WARN_FILL, font_colour=WARN_TXT)
    cf(ws, "E32", '=AND($C$8<>"",$B$32>=$C$8)', fill=OK_FILL, font_colour=OK_TXT)

    ws.freeze_panes = "A12"
    ws.sheet_properties.tabColor = ORANGE


# ---------------------------------------------------------------------------
# BASE CONTROLES — permanent source of truth. One row = one employee control.
# Columns B..I are the only pasted (raw) columns; everything else is derived.
# ---------------------------------------------------------------------------
BASE_HEADERS = [
    "ID CONTROLE", "DATE", "HEURE", "ID RUN", "TOUR", "LIGNE", "MATRICULE",
    "NB BOÎTES", "EFFECTIF LIGNE", "NOM ET PRENOM", "ACTIVITÉ", "ESPÈCE",
    "PRODUIT", "MARQUE", "FORMAT", "PRÉPARATION", "MOULE", "STANDARD",
    "HEURE CONTROLE PRECEDENT", "DUREE MESUREE MIN", "CADENCE BOITES/H/FEMME",
    "ATTEINTE %", "STATUT PERFORMANCE", "CONTROLE VALIDE",
]


def build_base(ws):
    widths(ws, {"A": 28, "B": 12, "C": 10, "D": 24, "E": 11, "F": 9, "G": 14,
                "H": 11, "I": 12, "J": 28, "K": 22, "L": 14, "M": 16, "N": 15,
                "O": 14, "P": 13, "Q": 14, "R": 12, "S": 15, "T": 13,
                "U": 15, "V": 12, "W": 20, "X": 18})

    title(ws, "A1:X1", "BASE CONTROLES — HISTORIQUE PERMANENT")
    note(ws, "A2:X2",
         "Base continue : ne jamais vider, ne jamais creer une feuille par jour ou "
         "par ligne. Coller uniquement les colonnes DATE a EFFECTIF LIGNE (B a I) "
         "depuis SAISIE CONTROLE ; toutes les autres colonnes se calculent seules. "
         "L'heure est saisie une fois par TOUR et par LIGNE : un horodatage "
         "automatique fige demande une macro (voir le rapport de livraison).")
    headers(ws, BASE_HDR, 1, BASE_HEADERS)

    def prev(letter, r):
        """Backward window for row `r`. Anchored at the header while the window
        would reach above it, then fully relative so Excel slides it when the
        table grows."""
        start = r - LOOKBACK
        if start <= BASE_HDR:
            return "$%s$%d:$%s%d" % (letter, BASE_HDR, letter, r - 1)
        return "$%s%d:$%s%d" % (letter, start, letter, r - 1)

    for r in range(BASE_FIRST, BASE_FILLED + 1):
        c = calc_cell(ws, "A%d" % r, "General", align="left")
        c.font = Font(name=FONT_NAME, size=9, color=GREY_TXT)
        c.value = ('=IF(OR($B{r}="",$G{r}=""),"",TEXT($B{r},"YYYYMMDD")&"-"'
                   '&SUBSTITUTE($E{r}," ","")&"-"&$F{r}&"-"&$G{r})').format(r=r)
        input_cell(ws, "B%d" % r, FMT_DATE)
        input_cell(ws, "C%d" % r, FMT_TIME)
        input_cell(ws, "D%d" % r, "General", align="left")
        input_cell(ws, "E%d" % r, "General")
        input_cell(ws, "F%d" % r, "General")
        input_cell(ws, "G%d" % r, "@")
        input_cell(ws, "H%d" % r, FMT_INT)
        input_cell(ws, "I%d" % r, FMT_INT)

        c = calc_cell(ws, "J%d" % r, "General", align="left")
        c.value = ('=IF($G{r}="","",IFERROR(INDEX(NomsEmployes,'
                   'MATCH($G{r},MatriculesEmployes,0)),"MATRICULE INCONNU"))').format(r=r)
        c = calc_cell(ws, "K%d" % r, "General")
        c.value = '=IF(OR($D{r}="",$F{r}=""),"",{e})'.format(
            r=r, e=run_activite("$D%d" % r, "$F%d" % r))
        for letter, src in (("L", "E"), ("M", "F"), ("N", "G"), ("O", "H"),
                            ("P", "J"), ("Q", "K")):
            c = calc_cell(ws, "%s%d" % (letter, r), "General")
            c.value = '=IF($D{r}="","",{e})'.format(r=r, e=run_field(src, "$D%d" % r))
        c = calc_cell(ws, "R%d" % r, FMT_DEC)
        c.value = '=IF(OR($L{r}="",$K{r}=""),"",{e})'.format(
            r=r, e=std_lookup("$L%d" % r, "$M%d" % r, "$N%d" % r, "$O%d" % r,
                              "$P%d" % r, "$Q%d" % r, "$K%d" % r))

        c = calc_cell(ws, "S%d" % r, FMT_TIME)
        c.value = ('=IF(OR($G{r}="",$X{r}<>"VALIDE"),"",IFERROR(LOOKUP(2,'
                   '1/(({pb}=$B{r})*({pg}=$G{r})*({px}="VALIDE")),{pc}),""))').format(
            r=r, pb=prev("B", r), pg=prev("G", r), px=prev("X", r), pc=prev("C", r))
        c = calc_cell(ws, "T%d" % r, FMT_INT)
        c.value = ('=IF(OR($C{r}="",$S{r}=""),"",'
                   'ROUND(($C{r}-$S{r}+IF($C{r}<$S{r},1,0))*1440,0))').format(r=r)
        c = calc_cell(ws, "U%d" % r, FMT_DEC, bold=True)
        c.value = '=IF(OR($H{r}="",$T{r}="",$T{r}<=0),"",$H{r}*60/$T{r})'.format(r=r)
        c = calc_cell(ws, "V%d" % r, FMT_PCT)
        c.value = '=IF(OR($U{r}="",$R{r}="",$R{r}=0),"",$U{r}/$R{r})'.format(r=r)
        c = calc_cell(ws, "W%d" % r, "General", bold=True)
        c.value = (
            '=IF($G{r}="","",'
            'IF($X{r}="CONTEXTE INCOMPLET","CONTEXTE INCOMPLET",'
            'IF($X{r}="DOUBLON",StatutDoublon,'
            'IF($S{r}="",StatutInitial,'
            'IF($R{r}="",StatutStandardManquant,'
            'IF($V{r}="","DONNEES INSUFFISANTES",'
            'IF($V{r}>=SeuilConforme,StatutConforme,'
            'IF($V{r}>=SeuilSurveiller,StatutSurveiller,'
            'StatutSousStandard))))))))').format(r=r)
        c = calc_cell(ws, "X%d" % r, "General")
        c.value = (
            '=IF($G{r}="","",'
            'IF(OR($D{r}="",$E{r}="",$F{r}=""),"CONTEXTE INCOMPLET",'
            'IF(COUNTIFS({pd},$D{r},{pe},$E{r},{pf},$F{r},{pg},$G{r})>0,'
            '"DOUBLON","VALIDE")))').format(
            r=r, pd=prev("D", r), pe=prev("E", r), pf=prev("F", r), pg=prev("G", r))

    add_table(ws, "T_BASE", "A%d:X%d" % (BASE_HDR, BASE_FILLED))
    rows_height(ws, BASE_FIRST, BASE_FILLED, 15)

    last = BASE_FILLED
    dv(ws, ["D%d:D%d" % (BASE_FIRST, last)], "=ListeRuns")
    dv(ws, ["E%d:E%d" % (BASE_FIRST, last)], "=ListeTours")
    dv(ws, ["F%d:F%d" % (BASE_FIRST, last)], "=ListeLignes")
    dv(ws, ["G%d:G%d" % (BASE_FIRST, last)], "=ListeMatricules")
    dv(ws, ["H%d:H%d" % (BASE_FIRST, last)], "0", dv_type="whole",
       operator="greaterThan", error_title="NB BOITES INVALIDE",
       error="Le nombre de boites doit etre un entier strictement positif.")

    zone = "W%d:W%d" % (BASE_FIRST, last)
    cf(ws, zone, '=$W%d=StatutConforme' % BASE_FIRST, fill=OK_FILL, font_colour=OK_TXT, bold=True)
    cf(ws, zone, '=$W%d=StatutSurveiller' % BASE_FIRST, fill=WARN_FILL, font_colour=WARN_TXT, bold=True)
    cf(ws, zone, '=$W%d=StatutSousStandard' % BASE_FIRST, fill=BAD_FILL, font_colour=BAD_TXT, bold=True)
    cf(ws, zone, '=AND($W%d<>"",$U%d="")' % (BASE_FIRST, BASE_FIRST),
       fill=NEUTRAL_FILL, font_colour=NEUTRAL_TXT, italic=True)
    cf(ws, "X%d:X%d" % (BASE_FIRST, last), '=$X%d="DOUBLON"' % BASE_FIRST,
       fill=BAD_FILL, font_colour=BAD_TXT, bold=True)
    cf(ws, "X%d:X%d" % (BASE_FIRST, last), '=$X%d="CONTEXTE INCOMPLET"' % BASE_FIRST,
       fill=WARN_FILL, font_colour=WARN_TXT, bold=True)
    cf(ws, "J%d:J%d" % (BASE_FIRST, last), '=$J%d="MATRICULE INCONNU"' % BASE_FIRST,
       fill=BAD_FILL, font_colour=BAD_TXT)

    ws.freeze_panes = "C4"
    ws.sheet_properties.tabColor = TEAL


# ---------------------------------------------------------------------------
# SYNTHESE CONTROLES — one RUN + TOUR, the eight lines side by side.
# ---------------------------------------------------------------------------
SYN_HDR = 8
SYN_FIRST = 9
SYN_LAST = 16
SYN_TOTAL = 17


def build_synthese(ws):
    widths(ws, {"A": 10, "B": 24, "C": 12, "D": 13, "E": 13, "F": 14, "G": 15,
                "H": 14, "I": 12, "J": 12, "K": 13, "L": 15, "M": 13, "N": 13})

    title(ws, "A1:N1", "SYNTHESE CONTROLES — PAR RUN ET PAR TOUR")
    note(ws, "A2:N2",
         "Choisir un ID RUN et un TOUR : les huit lignes se calculent seules. "
         "La cadence MO est une productivite ponderee (total boites / total "
         "heures-femmes mesurees), jamais une moyenne des cadences individuelles.")

    section(ws, "A3:N3", "SELECTION")
    label_cell(ws, "A4", "ID RUN", align="left")
    ws.merge_cells("C4:D4")
    input_cell(ws, "C4", "General")
    label_cell(ws, "A5", "TOUR", align="left")
    ws.merge_cells("C5:D5")
    input_cell(ws, "C5", "General")
    label_cell(ws, "F4", "DATE DU RUN")
    ws.merge_cells("G4:H4")
    c = calc_cell(ws, "G4", FMT_DATE, bold=True)
    c.value = '=IF($C$4="","",%s)' % run_field("B", "$C$4")
    label_cell(ws, "F5", "CONFIGURATION")
    ws.merge_cells("G5:N5")
    c = calc_cell(ws, "G5", "General", align="left", bold=True)
    c.value = ('=IF($C$4="","",_xlfn.TEXTJOIN(" / ",TRUE,{esp},{prod},{marq},'
               '{fmt},{prep},{moule}))').format(
        esp=run_field("E", "$C$4"), prod=run_field("F", "$C$4"),
        marq=run_field("G", "$C$4"), fmt=run_field("H", "$C$4"),
        prep=run_field("J", "$C$4"), moule=run_field("K", "$C$4"))
    rows_height(ws, 4, 5, 20)

    section(ws, "A7:N7", "SYNTHESE PAR LIGNE")
    headers(ws, SYN_HDR, 1, [
        "LIGNE", "ACTIVITÉ", "EFFECTIF PRESENT", "FEMMES CONTROLEES",
        "COUVERTURE %", "TOTAL BOITES CONTROLEES", "HEURES-FEMMES MESUREES",
        "CADENCE MO BOITES/H/FEMME", "STANDARD", "ATTEINTE %",
        "NB FEMMES CONFORMES", "NB FEMMES SOUS STANDARD", "CADENCE MIN",
        "CADENCE MAX"])

    for i, ligne in enumerate(LIGNES):
        r = SYN_FIRST + i
        crit = "{run},$C$4,{tour},$C$5,{lig},$A{r}".format(
            run=BRUN, tour=BTOUR, lig=BLIGNE, r=r)
        valid = crit + ',%s,"VALIDE"' % BVALIDE
        c = band_cell(ws, "A%d" % r, "General")
        c.value = ligne
        c = calc_cell(ws, "B%d" % r, "General")
        c.value = '=IF($C$4="","",{e})'.format(e=run_activite("$C$4", "$A%d" % r))
        c = calc_cell(ws, "C%d" % r, FMT_INT)
        c.value = ('=IF($C$4="","",IF(_xlfn.MAXIFS({eff},{c})=0,"",'
                   '_xlfn.MAXIFS({eff},{c})))').format(eff=BEFF, c=valid)
        c = calc_cell(ws, "D%d" % r, FMT_INT)
        c.value = '=IF($C$4="","",COUNTIFS({c}))'.format(c=valid)
        c = calc_cell(ws, "E%d" % r, FMT_PCT)
        c.value = '=IF(OR($C{r}="",$C{r}=0,$D{r}=""),"",$D{r}/$C{r})'.format(r=r)
        c = calc_cell(ws, "F%d" % r, FMT_INT)
        c.value = '=IF($C$4="","",SUMIFS({b},{c}))'.format(b=BBOITES, c=valid)
        c = calc_cell(ws, "G%d" % r, FMT_DEC)
        c.value = '=IF($C$4="","",SUMIFS({d},{c})/60)'.format(d=BDUREE, c=valid)
        c = calc_cell(ws, "H%d" % r, FMT_DEC, bold=True)
        c.value = '=IF(OR($G{r}="",$G{r}=0),"",$F{r}/$G{r})'.format(r=r)
        c = calc_cell(ws, "I%d" % r, FMT_DEC)
        c.value = ('=IF($C$4="","",IF(_xlfn.MAXIFS({s},{c})=0,"",'
                   '_xlfn.MAXIFS({s},{c})))').format(s=BSTD, c=valid)
        c = calc_cell(ws, "J%d" % r, FMT_PCT, bold=True)
        c.value = '=IF(OR($H{r}="",$I{r}="",$I{r}=0),"",$H{r}/$I{r})'.format(r=r)
        c = calc_cell(ws, "K%d" % r, FMT_INT)
        c.value = '=IF($C$4="","",COUNTIFS({c},{st},StatutConforme))'.format(
            c=crit, st=BSTATUT)
        c = calc_cell(ws, "L%d" % r, FMT_INT)
        c.value = '=IF($C$4="","",COUNTIFS({c},{st},StatutSousStandard))'.format(
            c=crit, st=BSTATUT)
        cad = valid + ',%s,">0"' % BCADENCE
        c = calc_cell(ws, "M%d" % r, FMT_DEC)
        c.value = ('=IF(COUNTIFS({c})=0,"",_xlfn.MINIFS({u},{c}))').format(
            c=cad, u=BCADENCE)
        c = calc_cell(ws, "N%d" % r, FMT_DEC)
        c.value = ('=IF(COUNTIFS({c})=0,"",_xlfn.MAXIFS({u},{c}))').format(
            c=cad, u=BCADENCE)
    rows_height(ws, SYN_FIRST, SYN_LAST, 19)

    f, l, t = SYN_FIRST, SYN_LAST, SYN_TOTAL
    totals = [
        ("A", "General", '="TOTAL"'),
        ("C", FMT_INT, '=SUM($C${f}:$C${l})'),
        ("D", FMT_INT, '=SUM($D${f}:$D${l})'),
        ("E", FMT_PCT, '=IF($C${t}=0,"",$D${t}/$C${t})'),
        ("F", FMT_INT, '=SUM($F${f}:$F${l})'),
        ("G", FMT_DEC, '=SUM($G${f}:$G${l})'),
        ("H", FMT_DEC, '=IF($G${t}=0,"",$F${t}/$G${t})'),
        ("I", FMT_DEC, '=IF(OR($C$4="",$G${t}=0),"",SUMPRODUCT('
                       'IF($G${f}:$G${l}="",0,$G${f}:$G${l})*'
                       'IF($I${f}:$I${l}="",0,$I${f}:$I${l}))/$G${t})'),
        ("J", FMT_PCT, '=IF(OR($H${t}="",$I${t}="",$I${t}=0),"",$H${t}/$I${t})'),
        ("K", FMT_INT, '=SUM($K${f}:$K${l})'),
        ("L", FMT_INT, '=SUM($L${f}:$L${l})'),
        ("M", FMT_DEC, '=IF(COUNT($M${f}:$M${l})=0,"",MIN($M${f}:$M${l}))'),
        ("N", FMT_DEC, '=IF(COUNT($N${f}:$N${l})=0,"",MAX($N${f}:$N${l}))'),
    ]
    for letter in "ABCDEFGHIJKLMN":
        c = ws.cell(t, openpyxl.utils.column_index_from_string(letter))
        c.font = Font(name=FONT_NAME, size=10, bold=True, color=WHITE)
        c.fill = PatternFill("solid", fgColor=NAVY)
        c.border = BORDER
        c.alignment = Alignment(horizontal="center", vertical="center")
    for letter, fmt, formula in totals:
        c = ws["%s%d" % (letter, t)]
        c.value = formula.format(f=f, l=l, t=t)
        c.number_format = fmt
    ws.row_dimensions[t].height = 22

    dv(ws, ["C4"], "=ListeRuns")
    dv(ws, ["C5"], "=ListeTours")

    body = "A%d:N%d" % (f, l)
    cf(ws, body, '=OR($B%d="INACTIVE",$B%d="")' % (f, f),
       fill=NEUTRAL_FILL, font_colour=NEUTRAL_TXT, italic=True)
    for zone in ("E%d:E%d" % (f, t), "J%d:J%d" % (f, t)):
        first = zone.split(":")[0][1:]
        cf(ws, zone, '=AND(${c}{r}<>"",${c}{r}>=1)'.format(c=zone[0], r=first),
           fill=OK_FILL, font_colour=OK_TXT, bold=True)
        cf(ws, zone, '=AND(${c}{r}<>"",${c}{r}>=SeuilAlerte,${c}{r}<1)'.format(
            c=zone[0], r=first), fill=WARN_FILL, font_colour=WARN_TXT, bold=True)
        cf(ws, zone, '=AND(${c}{r}<>"",${c}{r}<SeuilAlerte)'.format(c=zone[0], r=first),
           fill=BAD_FILL, font_colour=BAD_TXT, bold=True)
    cf(ws, "L%d:L%d" % (f, t), '=AND($L%d<>"",$L%d>0)' % (f, f),
       fill=BAD_FILL, font_colour=BAD_TXT, bold=True)

    ws.freeze_panes = "A9"
    ws.sheet_properties.tabColor = TEAL


# ---------------------------------------------------------------------------
# RECHERCHE MATRICULE — employee history and filtered detail.
# ---------------------------------------------------------------------------
RECH_COLUMNS = [
    ("A", "DATE", "B", FMT_DATE), ("B", "HEURE", "C", FMT_TIME),
    ("C", "ID RUN", "D", "General"), ("D", "TOUR", "E", "General"),
    ("E", "LIGNE", "F", "General"), ("F", "ACTIVITÉ", "K", "General"),
    ("G", "PRODUIT", "M", "General"), ("H", "MARQUE", "N", "General"),
    ("I", "FORMAT", "O", "General"), ("J", "PRÉPARATION", "P", "General"),
    ("K", "MOULE", "Q", "General"), ("L", "NB BOÎTES", "H", FMT_INT),
    ("M", "DUREE MESUREE MIN", "T", FMT_INT),
    ("N", "CADENCE BOITES/H/FEMME", "U", FMT_DEC),
    ("O", "STANDARD", "R", FMT_DEC), ("P", "ATTEINTE %", "V", FMT_PCT),
    ("Q", "STATUT PERFORMANCE", "W", "General"),
]


def build_recherche(ws):
    widths(ws, {"A": 12, "B": 9, "C": 22, "D": 11, "E": 8, "F": 20, "G": 16,
                "H": 15, "I": 14, "J": 13, "K": 14, "L": 11, "M": 12,
                "N": 14, "O": 11, "P": 12, "Q": 20, "S": 7, "U": 22, "V": 9})

    title(ws, "A1:Q1", "RECHERCHE MATRICULE — HISTORIQUE EMPLOYE")
    note(ws, "A2:Q2",
         "Choisir un matricule : la synthese porte sur tout l'historique de BASE "
         "CONTROLES. Les filtres ne servent qu'au detail ; laisser un filtre vide "
         "signifie TOUS.")

    section(ws, "A3:Q3", "EMPLOYE")
    label_cell(ws, "A4", "MATRICULE", align="left")
    input_cell(ws, "B4", "@")
    label_cell(ws, "C4", "NOM ET PRENOM")
    ws.merge_cells("D4:H4")
    c = calc_cell(ws, "D4", "General", align="left", bold=True)
    c.value = ('=IF($B$4="","",IFERROR(INDEX(NomsEmployes,'
               'MATCH($B$4,MatriculesEmployes,0)),"MATRICULE INCONNU"))')
    ws.row_dimensions[4].height = 21

    mat = '{m},$B$4,{v},"VALIDE"'.format(m=BMAT, v=BVALIDE)
    section(ws, "A6:Q6", "SYNTHESE HISTORIQUE")
    headers(ws, 7, 1, [
        "NB CONTROLES", "TOTAL BOITES CONTROLEES", "CADENCE MOYENNE PONDEREE",
        "CADENCE MIN", "CADENCE MAX", "ATTEINTE MOYENNE %",
        "DERNIER CONTROLE"], colour=TEAL)
    mes = mat + ',{d},">0"'.format(d=BDUREE)
    cad = mat + ',{u},">0"'.format(u=BCADENCE)
    att = mat + ',{v},">0"'.format(v=BATTEINTE)
    summary = [
        ("A8", FMT_INT, '=IF($B$4="","",COUNTIFS({m}))'.format(m=mat)),
        ("B8", FMT_INT, '=IF($B$4="","",SUMIFS({b},{m}))'.format(b=BBOITES, m=mat)),
        ("C8", FMT_DEC,
         '=IF(OR($B$4="",SUMIFS({d},{c})=0),"",SUMIFS({b},{c})*60/SUMIFS({d},{c}))'
         .format(d=BDUREE, b=BBOITES, c=mes)),
        ("D8", FMT_DEC,
         '=IF(COUNTIFS({c})=0,"",_xlfn.MINIFS({u},{c}))'.format(c=cad, u=BCADENCE)),
        ("E8", FMT_DEC,
         '=IF(COUNTIFS({c})=0,"",_xlfn.MAXIFS({u},{c}))'.format(c=cad, u=BCADENCE)),
        ("F8", FMT_PCT,
         '=IF(COUNTIFS({c})=0,"",AVERAGEIFS({v},{c}))'.format(c=att, v=BATTEINTE)),
        ("G8", FMT_DATE,
         '=IF(OR($B$4="",COUNTIFS({m})=0),"",_xlfn.MAXIFS({d},{m}))'
         .format(m=mat, d=BDATE)),
    ]
    for coord, fmt, formula in summary:
        c = calc_cell(ws, coord, fmt, bold=True)
        c.value = formula
    ws.row_dimensions[8].height = 22

    for r, lab, helper in ((9, "PRODUITS TRAVAILLES", "$U$%d:$U$%d" % (RECH_FIRST, RECH_FIRST + 21)),
                           (10, "LIGNES TRAVAILLEES", "$V$%d:$V$%d" % (RECH_FIRST, RECH_FIRST + 7))):
        label_cell(ws, "A%d" % r, lab, align="left")
        ws.merge_cells("B%d:Q%d" % (r, r))
        c = calc_cell(ws, "B%d" % r, "General", align="left")
        c.value = '=IF($B$4="","",_xlfn.TEXTJOIN(", ",TRUE,%s))' % helper
        ws.row_dimensions[r].height = 19

    section(ws, "A12:Q12", "FILTRES DU DETAIL — LAISSER VIDE = TOUS")
    headers(ws, 13, 1, ["PRODUIT", "MARQUE", "FORMAT", "PRÉPARATION", "MOULE",
                        "LIGNE", "DATE DÉBUT", "DATE FIN"], colour=TEAL)
    for letter in "ABCDEF":
        input_cell(ws, "%s14" % letter, "General")
    input_cell(ws, "G14", FMT_DATE)
    input_cell(ws, "H14", FMT_DATE)
    ws.row_dimensions[14].height = 20

    section(ws, "A15:Q15", "DETAIL DES CONTROLES — DU PLUS RECENT AU PLUS ANCIEN")
    headers(ws, RECH_HDR, 1, [label for _c, label, _s, _f in RECH_COLUMNS])
    c = ws.cell(RECH_HDR, 19, "INDEX")
    c.font = Font(name=FONT_NAME, size=8, color=GREY_TXT)

    cond = ("({m}=$B$4)*({v}=\"VALIDE\")"
            "*(({p}=$A$14)+($A$14=\"\")>0)"
            "*(({mq}=$B$14)+($B$14=\"\")>0)"
            "*(({f}=$C$14)+($C$14=\"\")>0)"
            "*(({pr}=$D$14)+($D$14=\"\")>0)"
            "*(({mo}=$E$14)+($E$14=\"\")>0)"
            "*(({l}=$F$14)+($F$14=\"\")>0)"
            "*(({d}>=$G$14)+($G$14=\"\")>0)"
            "*(({d}<=$H$14)+($H$14=\"\")>0)").format(
        m=BMAT, v=BVALIDE, p=BPRODUIT, mq=BMARQUE, f=BFORMAT, pr=BPREP,
        mo=BMOULE, l=BLIGNE, d=BDATE)

    for i in range(RECH_LAST - RECH_FIRST + 1):
        r = RECH_FIRST + i
        c = ws.cell(r, 19)
        c.font = Font(name=FONT_NAME, size=8, color=GREY_TXT)
        c.value = ('=IF($B$4="","",IFERROR(SUMPRODUCT(LARGE(IF({cond},'
                   'ROW({m})-{first}+1),{k})),""))').format(
            cond=cond, m=BMAT, first=BASE_FIRST, k=i + 1)
        for letter, _label, src, fmt in RECH_COLUMNS:
            cell = calc_cell(ws, "%s%d" % (letter, r), fmt,
                             align="left" if letter in "CFGHQ" else "center")
            cell.value = ('=IF($S{r}="","",INDEX({b}$%s${bf}:$%s${bs},$S{r}))'
                          % (src, src)).format(r=r, b=B, bf=BASE_FIRST, bs=BASE_SCAN)
    rows_height(ws, RECH_FIRST, RECH_LAST, 15)

    for i in range(22):
        r = RECH_FIRST + i
        p = LIST_FIRST + i
        c = ws.cell(r, 21)
        c.font = Font(name=FONT_NAME, size=8, color=GREY_TXT)
        c.value = ('=IF(PARAMETRES!$C{p}="","",IF(COUNTIFS({m},$B$4,{pr},'
                   'PARAMETRES!$C{p},{v},"VALIDE")>0,PARAMETRES!$C{p},""))').format(
            p=p, m=BMAT, pr=BPRODUIT, v=BVALIDE)
    for i in range(8):
        r = RECH_FIRST + i
        p = LIST_FIRST + i
        c = ws.cell(r, 22)
        c.font = Font(name=FONT_NAME, size=8, color=GREY_TXT)
        c.value = ('=IF(PARAMETRES!$A{p}="","",IF(COUNTIFS({m},$B$4,{l},'
                   'PARAMETRES!$A{p},{v},"VALIDE")>0,PARAMETRES!$A{p},""))').format(
            p=p, m=BMAT, l=BLIGNE, v=BVALIDE)
    for letter in ("S", "U", "V"):
        ws.column_dimensions[letter].hidden = True

    dv(ws, ["B4"], "=ListeMatricules")
    dv(ws, ["A14"], "=ListeProduits")
    dv(ws, ["B14"], "=ListeMarques")
    dv(ws, ["C14"], "=ListeFormats")
    dv(ws, ["D14"], "=ListePreparations")
    dv(ws, ["E14"], "=ListeMoules")
    dv(ws, ["F14"], "=ListeLignes")

    zone = "Q%d:Q%d" % (RECH_FIRST, RECH_LAST)
    cf(ws, zone, '=$Q%d=StatutConforme' % RECH_FIRST, fill=OK_FILL, font_colour=OK_TXT, bold=True)
    cf(ws, zone, '=$Q%d=StatutSurveiller' % RECH_FIRST, fill=WARN_FILL, font_colour=WARN_TXT, bold=True)
    cf(ws, zone, '=$Q%d=StatutSousStandard' % RECH_FIRST, fill=BAD_FILL, font_colour=BAD_TXT, bold=True)
    cf(ws, zone, '=AND($Q%d<>"",$N%d="")' % (RECH_FIRST, RECH_FIRST),
       fill=NEUTRAL_FILL, font_colour=NEUTRAL_TXT, italic=True)

    ws.freeze_panes = "A17"
    ws.sheet_properties.tabColor = TEAL


# ---------------------------------------------------------------------------
# TEST RENDEMENT — punctual material-yield tests, kept apart from cadence.
# ---------------------------------------------------------------------------
def build_test_rendement(ws):
    widths(ws, {"A": 24, "B": 12, "C": 14, "D": 28, "E": 14, "F": 16, "G": 15,
                "H": 14, "I": 13, "J": 14, "K": 16, "L": 18, "M": 14,
                "N": 19, "O": 40})

    title(ws, "A1:O1", "TEST RENDEMENT — TESTS PONCTUELS MATIERE")
    note(ws, "A2:O2",
         "Systeme separe du controle horaire de cadence : une femme, une quantite "
         "de matiere premiere connue, une quantite de sortie pesee. "
         "RENDEMENT % = QUANTITE SORTIE KG / QUANTITE MP KG. Historique permanent.")
    headers(ws, TEST_HDR, 1, [
        "ID TEST", "DATE", "MATRICULE", "NOM ET PRENOM", "ESPÈCE", "PRODUIT",
        "MARQUE", "FORMAT", "PRÉPARATION", "MOULE", "QUANTITE MP KG",
        "QUANTITE SORTIE KG", "RENDEMENT %", "TYPE TEST", "OBSERVATION"])

    for r in range(TEST_FIRST, TEST_LAST + 1):
        c = calc_cell(ws, "A%d" % r, "General", align="left")
        c.font = Font(name=FONT_NAME, size=9, color=GREY_TXT)
        c.value = ('=IF(OR($B{r}="",$C{r}=""),"","TR-"&TEXT($B{r},"YYYYMMDD")&"-"'
                   '&$C{r}&"-"&TEXT(COUNTIFS($B${h}:$B{r},$B{r},$C${h}:$C{r},$C{r}),'
                   '"00"))').format(r=r, h=TEST_HDR)
        input_cell(ws, "B%d" % r, FMT_DATE)
        input_cell(ws, "C%d" % r, "@")
        c = calc_cell(ws, "D%d" % r, "General", align="left")
        c.value = ('=IF($C{r}="","",IFERROR(INDEX(NomsEmployes,'
                   'MATCH($C{r},MatriculesEmployes,0)),"MATRICULE INCONNU"))').format(r=r)
        for letter in "EFGHIJ":
            input_cell(ws, "%s%d" % (letter, r), "General",
                       align="left" if letter in "FG" else "center")
        input_cell(ws, "K%d" % r, FMT_KG)
        input_cell(ws, "L%d" % r, FMT_KG)
        c = calc_cell(ws, "M%d" % r, FMT_PCT, bold=True)
        c.value = '=IF(OR($K{r}="",$L{r}="",$K{r}<=0),"",$L{r}/$K{r})'.format(r=r)
        input_cell(ws, "N%d" % r, "General")
        input_cell(ws, "O%d" % r, "General", align="left")
    add_table(ws, "T_TESTS", "A%d:O%d" % (TEST_HDR, TEST_LAST))
    rows_height(ws, TEST_FIRST, TEST_LAST, 15)

    last = TEST_LAST
    dv(ws, ["C%d:C%d" % (TEST_FIRST, last)], "=ListeMatricules")
    dv(ws, ["E%d:E%d" % (TEST_FIRST, last)], "=ListeEspeces")
    dv(ws, ["F%d:F%d" % (TEST_FIRST, last)], "=ListeProduits")
    dv(ws, ["G%d:G%d" % (TEST_FIRST, last)], "=ListeMarques")
    dv(ws, ["H%d:H%d" % (TEST_FIRST, last)], "=ListeFormats")
    dv(ws, ["I%d:I%d" % (TEST_FIRST, last)], "=ListePreparations")
    dv(ws, ["J%d:J%d" % (TEST_FIRST, last)], "=ListeMoules")
    dv(ws, ["N%d:N%d" % (TEST_FIRST, last)], "=ListeTypesTest")
    dv(ws, ["K%d:L%d" % (TEST_FIRST, last)], "0", dv_type="decimal",
       operator="greaterThan", error_title="QUANTITE INVALIDE",
       error="La quantite en kilogrammes doit etre strictement positive.")

    zone = "M%d:M%d" % (TEST_FIRST, last)
    cf(ws, zone, '=AND($M%d<>"",$M%d>1)' % (TEST_FIRST, TEST_FIRST),
       fill=BAD_FILL, font_colour=BAD_TXT, bold=True)

    ws.freeze_panes = "B4"
    ws.sheet_properties.tabColor = WARN_TXT


# ---------------------------------------------------------------------------
# ARRETS — simplified downtime log carried over from v1.3.
# ---------------------------------------------------------------------------
def build_arrets(ws):
    widths(ws, {"A": 12, "B": 24, "C": 10, "D": 14, "E": 14, "F": 14,
                "G": 26, "H": 46})

    title(ws, "A1:H1", "ARRETS — SUIVI SIMPLIFIE DES ARRETS DE LIGNE")
    note(ws, "A2:H2",
         "Journal d'arrets repris de la version 1.3 et simplifie. La duree se "
         "calcule seule et gere le passage de minuit. Ce suivi n'entre pas dans "
         "le calcul des cadences individuelles.")
    headers(ws, ARRET_HDR, 1, [
        "DATE", "ID RUN", "LIGNE", "HEURE DEBUT", "HEURE FIN", "DUREE MIN",
        "MOTIF", "OBSERVATION"])

    for r in range(ARRET_FIRST, ARRET_LAST + 1):
        input_cell(ws, "A%d" % r, FMT_DATE)
        input_cell(ws, "B%d" % r, "General", align="left")
        input_cell(ws, "C%d" % r, "General")
        input_cell(ws, "D%d" % r, FMT_TIME)
        input_cell(ws, "E%d" % r, FMT_TIME)
        c = calc_cell(ws, "F%d" % r, FMT_INT, bold=True)
        c.value = ('=IF(OR($D{r}="",$E{r}=""),"",'
                   'ROUND(($E{r}-$D{r}+IF($E{r}<$D{r},1,0))*1440,0))').format(r=r)
        input_cell(ws, "G%d" % r, "General")
        input_cell(ws, "H%d" % r, "General", align="left")
    add_table(ws, "T_ARRETS", "A%d:H%d" % (ARRET_HDR, ARRET_LAST))
    rows_height(ws, ARRET_FIRST, ARRET_LAST, 15)

    last = ARRET_LAST
    dv(ws, ["B%d:B%d" % (ARRET_FIRST, last)], "=ListeRuns")
    dv(ws, ["C%d:C%d" % (ARRET_FIRST, last)], "=ListeLignes")
    dv(ws, ["G%d:G%d" % (ARRET_FIRST, last)], "=ListeMotifs")

    cf(ws, "F%d:F%d" % (ARRET_FIRST, last),
       '=AND($F%d<>"",$F%d>=60)' % (ARRET_FIRST, ARRET_FIRST),
       fill=BAD_FILL, font_colour=BAD_TXT, bold=True)
    cf(ws, "F%d:F%d" % (ARRET_FIRST, last),
       '=AND($F%d<>"",$F%d>=30,$F%d<60)' % (ARRET_FIRST, ARRET_FIRST, ARRET_FIRST),
       fill=WARN_FILL, font_colour=WARN_TXT)

    ws.freeze_panes = "A4"
    ws.sheet_properties.tabColor = NEUTRAL_TXT


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------
SHEETS = [
    ("PARAMETRES", build_parametres),
    ("RUNS", build_runs),
    ("SAISIE CONTROLE", build_saisie),
    ("BASE CONTROLES", build_base),
    ("SYNTHESE CONTROLES", build_synthese),
    ("RECHERCHE MATRICULE", build_recherche),
    ("TEST RENDEMENT", build_test_rendement),
    ("ARRETS", build_arrets),
]

NAMES = {
    "SeuilConforme": "PARAMETRES!$B$5",
    "SeuilSurveiller": "PARAMETRES!$B$6",
    "SeuilAlerte": "PARAMETRES!$B$6",
    "StatutConforme": "PARAMETRES!$B$7",
    "StatutSurveiller": "PARAMETRES!$B$8",
    "StatutSousStandard": "PARAMETRES!$B$9",
    "StatutInitial": "PARAMETRES!$B$10",
    "StatutStandardManquant": "PARAMETRES!$B$11",
    "StatutDoublon": "PARAMETRES!$B$12",
    "MatriculesEmployes": "T_EMPLOYES[MATRICULE]",
    "NomsEmployes": "T_EMPLOYES[NOM ET PRENOM]",
    "ListeMatricules": "T_EMPLOYES[MATRICULE]",
    "ListeRuns": "T_RUNS[ID RUN]",
}


def main(path):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for name, builder in SHEETS:
        builder(wb.create_sheet(name))

    for name, expr in NAMES.items():
        wb.defined_names[name] = DefinedName(name, attr_text=expr)
    for _letter, header, table, name, _values, _w in LIST_COLUMNS:
        wb.defined_names[name] = DefinedName(name, attr_text="%s[%s]" % (table, header))

    for ws in wb.worksheets:
        ws.sheet_view.showGridLines = False
    # openpyxl writes no cached values; make Excel compute everything on open.
    wb.calculation.fullCalcOnLoad = True
    wb.save(path)
    print("saved %s" % path)


if __name__ == "__main__":
    main(sys.argv[1])
