# One-shot generator: Karthika category placeholders + 100% visual CSV.
# Does not modify the input CSV. Does not upload to Shopify.

from __future__ import annotations

import csv
import math
import os
from collections import Counter
from datetime import datetime, timezone

from PIL import Image, ImageDraw, ImageFilter, ImageFont

INPUT_CSV = r"C:\Users\joelt\Downloads\Karthika_Products_ALL_VERIFIED_IMAGES.csv"
OUT_CSV = r"C:\Users\joelt\Downloads\Karthika_Products_100_PERCENT_VISUAL.csv"
OUT_MAP = r"C:\Users\joelt\Downloads\Karthika_Placeholder_Mapping.csv"
OUT_REPORT = r"C:\Users\joelt\Downloads\Karthika_100_PERCENT_VISUAL_REPORT.txt"
ASSET_DIR = r"D:\works\IT\Karthika\assets\product-placeholders"

SIZE = 1200

GREEN = (63, 125, 46)
GREEN_DARK = (51, 101, 36)
MAROON = (110, 26, 42)
GOLD = (245, 196, 0)
YELLOW = (255, 201, 51)
BG = (245, 248, 236)
SURFACE = (239, 244, 227)
WHITE = (255, 255, 255)
TEXT = (23, 23, 23)
MUTED = (92, 107, 82)
LIGHT = (139, 148, 129)
BORDER = (225, 232, 211)

CATEGORIES = [
    "FOOD",
    "BEVERAGE",
    "SNACKS",
    "GROCERY",
    "HOUSEHOLD",
    "PERSONAL_CARE",
    "RELIGIOUS",
    "COSMETICS",
    "HEALTH",
    "STATIONERY",
    "CLEANING",
    "ELECTRONICS",
    "HARDWARE",
    "BABY",
    "CLOTHING",
    "OTHER",
]

LABELS = {
    "FOOD": "Food",
    "BEVERAGE": "Beverage",
    "SNACKS": "Snacks",
    "GROCERY": "Grocery",
    "HOUSEHOLD": "Household",
    "PERSONAL_CARE": "Personal Care",
    "RELIGIOUS": "Religious",
    "COSMETICS": "Cosmetics",
    "HEALTH": "Health",
    "STATIONERY": "Stationery",
    "CLEANING": "Cleaning",
    "ELECTRONICS": "Electronics",
    "HARDWARE": "Hardware",
    "BABY": "Baby",
    "CLOTHING": "Clothing",
    "OTHER": "Other",
}

ACCENTS = {
    "FOOD": (63, 125, 46),
    "BEVERAGE": (46, 107, 140),
    "SNACKS": (214, 140, 32),
    "GROCERY": (63, 125, 46),
    "HOUSEHOLD": (110, 90, 62),
    "PERSONAL_CARE": (90, 140, 150),
    "RELIGIOUS": (110, 26, 42),
    "COSMETICS": (150, 70, 100),
    "HEALTH": (40, 130, 100),
    "STATIONERY": (70, 100, 140),
    "CLEANING": (50, 130, 150),
    "ELECTRONICS": (70, 90, 130),
    "HARDWARE": (100, 90, 70),
    "BABY": (180, 120, 90),
    "CLOTHING": (90, 70, 120),
    "OTHER": (92, 107, 82),
}


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = (
        [r"C:\Windows\Fonts\segoeuib.ttf", r"C:\Windows\Fonts\calibrib.ttf"]
        if bold
        else [r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\calibri.ttf"]
    )
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def rounded_rect(draw, xy, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def ellipse(draw, cx, cy, rx, ry, fill, outline=None, width=1):
    draw.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=fill, outline=outline, width=width)


def line(draw, pts, fill, width=8):
    draw.line(pts, fill=fill, width=width, joint="curve")


def draw_icon(draw: ImageDraw.ImageDraw, cat: str, cx: int, cy: int, accent, ink):
    """Abstract category glyph — not a product photo or branded pack."""
    if cat == "FOOD":
        ellipse(draw, cx, cy + 40, 150, 55, None, ink, 10)
        ellipse(draw, cx, cy + 10, 170, 70, WHITE, ink, 10)
        ellipse(draw, cx - 40, cy - 30, 70, 28, accent, None)
        ellipse(draw, cx + 50, cy - 10, 50, 22, (255, 201, 51), None)
        ellipse(draw, cx + 10, cy - 50, 36, 36, GREEN, None)
    elif cat == "BEVERAGE":
        draw.polygon(
            [(cx - 55, cy - 130), (cx + 55, cy - 130), (cx + 70, cy + 120), (cx - 70, cy + 120)],
            fill=WHITE,
            outline=ink,
        )
        draw.line([(cx - 55, cy - 130), (cx + 55, cy - 130)], fill=ink, width=10)
        draw.rectangle([cx - 22, cy - 165, cx + 22, cy - 130], outline=ink, width=8)
        draw.polygon(
            [(cx - 40, cy - 40), (cx + 40, cy - 80), (cx + 48, cy + 40), (cx - 32, cy + 70)],
            fill=accent,
        )
    elif cat == "SNACKS":
        ellipse(draw, cx, cy + 30, 160, 90, WHITE, ink, 10)
        ellipse(draw, cx, cy + 10, 130, 55, (255, 236, 180), ink, 6)
        for dx, dy, r in [(-50, -40, 28), (10, -70, 34), (70, -30, 26), (-10, -10, 22)]:
            ellipse(draw, cx + dx, cy + dy, r, r, accent, ink, 4)
    elif cat == "GROCERY":
        draw.polygon(
            [(cx - 130, cy - 20), (cx + 130, cy - 20), (cx + 105, cy + 140), (cx - 105, cy + 140)],
            fill=WHITE,
            outline=ink,
        )
        line(draw, [(cx - 130, cy - 20), (cx - 70, cy - 110), (cx + 70, cy - 110), (cx + 130, cy - 20)], ink, 10)
        ellipse(draw, cx - 45, cy - 110, 18, 18, None, ink, 8)
        ellipse(draw, cx + 45, cy - 110, 18, 18, None, ink, 8)
        draw.rectangle([cx - 50, cy + 20, cx + 50, cy + 90], fill=accent)
    elif cat == "HOUSEHOLD":
        draw.polygon(
            [(cx, cy - 140), (cx + 150, cy - 20), (cx - 150, cy - 20)],
            fill=accent,
        )
        draw.rectangle([cx - 110, cy - 20, cx + 110, cy + 140], fill=WHITE, outline=ink, width=10)
        draw.rectangle([cx - 30, cy + 40, cx + 30, cy + 140], fill=SURFACE, outline=ink, width=8)
        draw.rectangle([cx - 90, cy + 20, cx - 45, cy + 70], outline=ink, width=8)
        draw.rectangle([cx + 45, cy + 20, cx + 90, cy + 70], outline=ink, width=8)
    elif cat == "PERSONAL_CARE":
        ellipse(draw, cx, cy - 20, 70, 90, WHITE, ink, 10)
        draw.polygon([(cx, cy - 130), (cx - 40, cy - 40), (cx + 40, cy - 40)], fill=accent)
        ellipse(draw, cx + 50, cy + 50, 90, 70, (180, 220, 230), ink, 8)
        ellipse(draw, cx + 20, cy + 30, 18, 18, WHITE)
    elif cat == "RELIGIOUS":
        ellipse(draw, cx, cy + 80, 110, 28, None, ink, 8)
        ellipse(draw, cx, cy + 55, 90, 22, GOLD)
        draw.polygon(
            [(cx - 70, cy + 50), (cx + 70, cy + 50), (cx + 40, cy + 10), (cx - 40, cy + 10)],
            fill=MAROON,
        )
        ellipse(draw, cx, cy - 40, 28, 70, YELLOW)
        ellipse(draw, cx, cy - 110, 18, 28, GOLD)
    elif cat == "COSMETICS":
        ellipse(draw, cx, cy + 20, 130, 130, WHITE, ink, 10)
        ellipse(draw, cx, cy + 20, 90, 90, (255, 220, 230), ink, 6)
        ellipse(draw, cx, cy + 20, 28, 28, accent)
        draw.rectangle([cx + 80, cy - 120, cx + 150, cy + 80], fill=WHITE, outline=ink, width=8)
        draw.rectangle([cx + 80, cy - 120, cx + 150, cy - 40], fill=accent)
    elif cat == "HEALTH":
        draw.rounded_rectangle([cx - 50, cy - 140, cx + 50, cy + 140], radius=24, fill=WHITE, outline=ink, width=10)
        draw.rectangle([cx - 18, cy - 70, cx + 18, cy + 70], fill=accent)
        draw.rectangle([cx - 70, cy - 18, cx + 70, cy + 18], fill=accent)
        ellipse(draw, cx, cy - 160, 22, 16, None, ink, 8)
    elif cat == "STATIONERY":
        draw.polygon(
            [(cx - 40, cy + 140), (cx - 10, cy - 150), (cx + 40, cy - 140), (cx + 10, cy + 150)],
            fill=WHITE,
            outline=ink,
        )
        draw.polygon([(cx - 10, cy - 150), (cx + 40, cy - 140), (cx + 18, cy - 190)], fill=accent)
        draw.rectangle([cx + 50, cy - 40, cx + 160, cy + 80], fill=SURFACE, outline=ink, width=8)
        line(draw, [(cx + 70, cy - 10), (cx + 140, cy - 10)], ink, 6)
        line(draw, [(cx + 70, cy + 20), (cx + 140, cy + 20)], ink, 6)
        line(draw, [(cx + 70, cy + 50), (cx + 120, cy + 50)], ink, 6)
    elif cat == "CLEANING":
        draw.polygon(
            [(cx - 40, cy - 40), (cx + 40, cy - 40), (cx + 70, cy + 140), (cx - 70, cy + 140)],
            fill=WHITE,
            outline=ink,
        )
        draw.rectangle([cx - 18, cy - 90, cx + 18, cy - 40], fill=accent, outline=ink, width=6)
        ellipse(draw, cx + 70, cy - 80, 50, 40, (180, 220, 235), ink, 6)
        ellipse(draw, cx + 110, cy - 40, 28, 22, (200, 230, 240), ink, 5)
        for a in range(8):
            ang = a * math.pi / 4
            x2, y2 = cx - 90 + math.cos(ang) * 40, cy - 90 + math.sin(ang) * 40
            line(draw, [(cx - 90, cy - 90), (x2, y2)], GOLD, 6)
    elif cat == "ELECTRONICS":
        draw.rounded_rectangle([cx - 140, cy - 90, cx + 140, cy + 90], radius=28, fill=WHITE, outline=ink, width=10)
        draw.rounded_rectangle([cx - 110, cy - 55, cx + 110, cy + 40], radius=12, fill=SURFACE, outline=ink, width=6)
        ellipse(draw, cx - 40, cy + 65, 10, 10, accent)
        ellipse(draw, cx, cy + 65, 10, 10, accent)
        ellipse(draw, cx + 40, cy + 65, 10, 10, accent)
        draw.rectangle([cx - 12, cy + 90, cx + 12, cy + 130], fill=ink)
        draw.rectangle([cx - 50, cy + 128, cx + 50, cy + 148], fill=ink)
    elif cat == "HARDWARE":
        # Wrench + nut, geometric
        draw.rounded_rectangle([cx - 20, cy - 140, cx + 20, cy + 80], radius=10, fill=accent)
        ellipse(draw, cx, cy - 150, 55, 55, WHITE, ink, 10)
        ellipse(draw, cx, cy - 150, 22, 22, BG)
        draw.polygon(
            [(cx + 10, cy + 40), (cx + 90, cy + 140), (cx + 50, cy + 160), (cx - 20, cy + 70)],
            fill=WHITE,
            outline=ink,
        )
        ellipse(draw, cx + 90, cy - 40, 50, 50, WHITE, ink, 10)
        ellipse(draw, cx + 90, cy - 40, 18, 18, BG)
    elif cat == "BABY":
        ellipse(draw, cx, cy - 40, 90, 90, WHITE, ink, 10)
        ellipse(draw, cx - 28, cy - 50, 12, 16, ink)
        ellipse(draw, cx + 28, cy - 50, 12, 16, ink)
        draw.arc([cx - 35, cy - 30, cx + 35, cy + 20], 20, 160, fill=ink, width=8)
        ellipse(draw, cx, cy + 90, 110, 70, accent, ink, 8)
        ellipse(draw, cx, cy + 70, 40, 24, WHITE, ink, 6)
    elif cat == "CLOTHING":
        line(draw, [(cx - 140, cy - 80), (cx + 140, cy - 80)], ink, 12)
        line(draw, [(cx, cy - 80), (cx, cy - 40)], ink, 10)
        draw.polygon(
            [(cx - 100, cy - 40), (cx + 100, cy - 40), (cx + 80, cy + 140), (cx - 80, cy + 140)],
            fill=WHITE,
            outline=ink,
        )
        draw.polygon(
            [(cx - 100, cy - 40), (cx - 150, cy + 40), (cx - 110, cy + 55), (cx - 70, cy - 10)],
            fill=accent,
            outline=ink,
        )
        draw.polygon(
            [(cx + 100, cy - 40), (cx + 150, cy + 40), (cx + 110, cy + 55), (cx + 70, cy - 10)],
            fill=accent,
            outline=ink,
        )
    else:  # OTHER
        draw.rounded_rectangle([cx - 120, cy - 90, cx + 120, cy + 110], radius=28, fill=WHITE, outline=ink, width=10)
        draw.rounded_rectangle([cx - 70, cy - 140, cx + 70, cy - 70], radius=16, fill=accent)
        line(draw, [(cx - 40, cy - 20), (cx + 40, cy - 20)], ink, 8)
        line(draw, [(cx - 40, cy + 20), (cx + 20, cy + 20)], ink, 8)
        line(draw, [(cx - 40, cy + 60), (cx + 50, cy + 60)], ink, 8)


def make_placeholder(cat: str, path: str) -> None:
    accent = ACCENTS[cat]
    img = Image.new("RGB", (SIZE, SIZE), BG)
    draw = ImageDraw.Draw(img)

    # Soft inner card
    rounded_rect(draw, [70, 70, SIZE - 70, SIZE - 70], 56, WHITE, BORDER, 4)
    # Top brand bar
    rounded_rect(draw, [70, 70, SIZE - 70, 210], 56, GREEN)
    draw.rectangle([70, 150, SIZE - 70, 210], fill=GREEN)

    # Gold underline
    draw.rectangle([70, 210, SIZE - 70, 222], fill=GOLD)

    f_brand = font(52, bold=True)
    f_badge = font(22, bold=True)
    f_cat = font(64, bold=True)
    f_sub = font(28, False)

    brand = "KARTHIKA"
    bbox = draw.textbbox((0, 0), brand, font=f_brand)
    tw = bbox[2] - bbox[0]
    draw.text(((SIZE - tw) / 2, 100), brand, fill=WHITE, font=f_brand)

    # Icon plate
    plate = [260, 280, SIZE - 260, 820]
    rounded_rect(draw, plate, 40, SURFACE, BORDER, 3)
    draw_icon(draw, cat, SIZE // 2, 530, accent, TEXT)

    label = LABELS[cat].upper()
    bbox = draw.textbbox((0, 0), label, font=f_cat)
    tw = bbox[2] - bbox[0]
    draw.text(((SIZE - tw) / 2, 860), label, fill=TEXT, font=f_cat)

    sub = "Category placeholder  ·  Not a product photo"
    bbox = draw.textbbox((0, 0), sub, font=f_sub)
    tw = bbox[2] - bbox[0]
    draw.text(((SIZE - tw) / 2, 940), sub, fill=MUTED, font=f_sub)

    # Pill badge
    badge = "PLACEHOLDER"
    bb = draw.textbbox((0, 0), badge, font=f_badge)
    bw = bb[2] - bb[0] + 40
    bh = 40
    bx = (SIZE - bw) / 2
    by = 1000
    rounded_rect(draw, [bx, by, bx + bw, by + bh], 20, GOLD)
    draw.text((bx + 20, by + 6), badge, fill=TEXT, font=f_badge)

    img = img.filter(ImageFilter.SMOOTH)
    img.save(path, "PNG", optimize=True)


TYPE_MAP = {
    # FOOD (fresh / prepared / dairy)
    "VEGETABLES": "FOOD",
    "FRESH": "FOOD",
    "PANEER": "FOOD",
    "YOGHURT": "FOOD",
    "CHEESE": "FOOD",
    "GHEE": "FOOD",
    "BUTTER": "FOOD",
    "MARGARINE": "FOOD",
    "CREAM": "FOOD",
    "FRESHCREAM": "FOOD",
    "UHT MILK": "FOOD",
    "FRESH MILK": "FOOD",
    "MILK POWDER": "FOOD",
    "EGGS": "FOOD",
    "MEAT": "FOOD",
    "MOCK MEATS": "FOOD",
    "BREAD": "FOOD",
    "PRATA/CHAPPATI": "FOOD",
    "READY TO EAT": "FOOD",
    "PIZZA": "FOOD",
    "IDLY": "FOOD",
    "DOSA MIX": "FOOD",
    "CUSTARD": "FOOD",
    "MANGO": "FOOD",
    "COCONUT": "FOOD",
    "GRATED COCONUT": "FOOD",
    "ONIONS": "FOOD",
    "GARLIC": "FOOD",
    "POTATO": "FOOD",
    "BANANA": "FOOD",
    "GINGER": "FOOD",
    "DRIED FISH": "FOOD",
    "COCONUT MILK/POWDER": "FOOD",
    "ICE CREAM": "FOOD",
    # SNACKS
    "SNACKS": "SNACKS",
    "COOKIES & BISCUITS": "SNACKS",
    "CHOCOLATES & SWEETS": "SNACKS",
    "FRUIT/NUT SNACKS": "SNACKS",
    "CAKES": "SNACKS",
    "SWEETMEATS": "SNACKS",
    "APPALAM & VADAGAM": "SNACKS",
    "DRY FRUITS & NUTS": "SNACKS",
    "TOPPING": "SNACKS",
    "POHA/PORI/PUFFED": "SNACKS",
    "SPARKLERS/PARTY": "SNACKS",
    # BEVERAGE
    "TEA": "BEVERAGE",
    "COFFEE": "BEVERAGE",
    "ICED COFFEE": "BEVERAGE",
    "ICED TEA": "BEVERAGE",
    "FRUIT DRINK /JUICE": "BEVERAGE",
    "SOFT DRINKS": "BEVERAGE",
    "LIQUOR": "BEVERAGE",
    "BEER": "BEVERAGE",
    "CORDIAL & SYRUP": "BEVERAGE",
    "ENERGY DRINK": "BEVERAGE",
    "SPORTS DRINK": "BEVERAGE",
    "MINERAL WATER": "BEVERAGE",
    "YOGHURT DRINK": "BEVERAGE",
    "DRINK MIX": "BEVERAGE",
    "MALT, MILO POWDERS": "BEVERAGE",
    "MILO, CHOC DRINK": "BEVERAGE",
    "HERBALJUIC": "BEVERAGE",
    "CREAMER": "BEVERAGE",
    "SOYA MILK": "BEVERAGE",
    # GROCERY pantry
    "MATTA": "GROCERY",
    "GRAINS/PULSES": "GROCERY",
    "FLOUR": "GROCERY",
    "SPICES & POWDERS": "GROCERY",
    "MASALA POWDERS": "GROCERY",
    "PICKLES & PASTE": "GROCERY",
    "SAUCES": "GROCERY",
    "CANNED FOODS": "GROCERY",
    "COOKING OIL": "GROCERY",
    "SALT": "GROCERY",
    "SUGAR & JAGGERY": "GROCERY",
    "BASMATI": "GROCERY",
    "PONNI": "GROCERY",
    "RAW": "GROCERY",
    "BROWN/RED": "GROCERY",
    "SONA MASURI": "GROCERY",
    "WHITE": "GROCERY",
    "KURUVA": "GROCERY",
    "JAYA": "GROCERY",
    "INSTANT MIX": "GROCERY",
    "NOODLES": "GROCERY",
    "PASTA": "GROCERY",
    "CEREALS & OATS": "GROCERY",
    "JAMS & SPREADS": "GROCERY",
    "HONEY": "GROCERY",
    "ESSENCE/COLOURINGS": "GROCERY",
    "SEASONINGS": "GROCERY",
    "HERBS": "GROCERY",
    "TAMARIND": "GROCERY",
    "DRIED CHILLI": "GROCERY",
    "ASAFOETIDA": "GROCERY",
    "SAFFRON": "GROCERY",
    "AGAR-AGAR/JELLY": "GROCERY",
    "ADA & VERMICELLI": "GROCERY",
    "YEAST": "GROCERY",
    "BI-CARBONATE SODA": "GROCERY",
    "VINEGAR": "GROCERY",
    "POWDERS": "GROCERY",
    # HOUSEHOLD
    "UTENSILS": "HOUSEHOLD",
    "PLASTICWARE": "HOUSEHOLD",
    "TAWA/KADAI/PAN": "HOUSEHOLD",
    "COOKER": "HOUSEHOLD",
    "CASSEROLE": "HOUSEHOLD",
    "KETTLE/FLASK": "HOUSEHOLD",
    "GLASS": "HOUSEHOLD",
    "STORAGE BAG": "HOUSEHOLD",
    "ALUMINIUM FOIL/TRAY": "HOUSEHOLD",
    "TISSUE/NAPKINS": "HOUSEHOLD",
    "TOOVAKAL": "HOUSEHOLD",
    "UMBERELLA/RAINCOAT": "HOUSEHOLD",
    # PERSONAL CARE
    "HAIRCARE": "PERSONAL_CARE",
    "FACIAL CARE": "PERSONAL_CARE",
    "SOAPS": "PERSONAL_CARE",
    "BODYCARE": "PERSONAL_CARE",
    "SKINCARE": "PERSONAL_CARE",
    "SHAVING": "PERSONAL_CARE",
    "TOOTHPASTE": "PERSONAL_CARE",
    "TOOTHBRUSH": "PERSONAL_CARE",
    "DENTAL": "PERSONAL_CARE",
    "SHOWER GEL": "PERSONAL_CARE",
    "TOILETRIES": "PERSONAL_CARE",
    "TALCUM": "PERSONAL_CARE",
    "ADULT HYGIENE": "PERSONAL_CARE",
    "HAND WASH/SANITIZER": "PERSONAL_CARE",
    "DEODORANTS": "PERSONAL_CARE",
    # RELIGIOUS
    "INCENSE STICKS": "RELIGIOUS",
    "AGARBATHI": "RELIGIOUS",
    "SAMBRANI": "RELIGIOUS",
    "KUM KUM/TURMERIC": "RELIGIOUS",
    "COTTON WICKS": "RELIGIOUS",
    "CAMPHOR": "RELIGIOUS",
    "LAMPS/VILAKU": "RELIGIOUS",
    "VILAKU": "RELIGIOUS",
    "PRAYER OIL": "RELIGIOUS",
    "JASMINE": "RELIGIOUS",
    "ROSE WATER": "RELIGIOUS",
    "BRASS": "RELIGIOUS",
    "COPPER": "RELIGIOUS",
    # COSMETICS
    "COSMETICS": "COSMETICS",
    "PERFUME": "COSMETICS",
    # HEALTH
    "AYURVEDA MEDICINE": "HEALTH",
    "TABLETS": "HEALTH",
    "PAIN BALMS/OILS": "HEALTH",
    "FIRST-AID": "HEALTH",
    "COUGH SYRUP": "HEALTH",
    "PLASTER": "HEALTH",
    "HEALTH MIX": "HEALTH",
    "NUTRITION": "HEALTH",
    "DIABETIC": "HEALTH",
    "LOZENGES": "HEALTH",
    "GLUCOSE": "HEALTH",
    "BABY FOOD": "HEALTH",
    # STATIONERY
    "STATIONERY": "STATIONERY",
    "MAGAZINE/NEWSPAPER": "STATIONERY",
    "PLAYING CARDS": "STATIONERY",
    # CLEANING
    "DETERGENTS": "CLEANING",
    "CLEANING ACCESSORIES": "CLEANING",
    "CLEANERS": "CLEANING",
    "PEST CONTROL": "CLEANING",
    "DISHWASHING": "CLEANING",
    "AIR FRESHNER": "CLEANING",
    # ELECTRONICS
    "ELECTRICALS": "ELECTRONICS",
    "MIXER/GRINDER": "ELECTRONICS",
    "BLENDER": "ELECTRONICS",
    # HARDWARE
    "HARDWARE": "HARDWARE",
    "LOCKS": "HARDWARE",
    "LIGHTERS/CANDLES": "HARDWARE",
    "CHARCOAL": "HARDWARE",
    "DEF": "HARDWARE",
    "MAINTENANCE": "HARDWARE",
    # BABY
    "BABY CARE": "BABY",
    "BABY FORMULA": "BABY",
    "BABY OIL": "BABY",
    "TOYS": "BABY",
    # OTHER
    "MISCELLANEOUS": "OTHER",
    "MISC": "OTHER",
    "CIGARETTES": "OTHER",
    "ITEMS": "OTHER",
    "ACCESSORIES": "OTHER",
    "TRAVEL": "OTHER",
}

TITLE_RULES = [
    ("CLOTHING", ("saree", "sari", "shirt", "dhoti", "veshti", "blouse", "kurta", "dupatta", "legging", "sock", "innerwear", "brief", "vest ", "t-shirt", "tshirt", "raincoat", "umbrella")),
    ("BABY", ("baby ", "infant", "diaper", "nappy", "wipes", "formula")),
    ("RELIGIOUS", ("pooja", "puja", "agarbatti", "agarbathi", "sambrani", "camphor", "vilakku", "vilaku", "diya", "deepam", "kumkum", "vibhuti", "rudraksha", "turmeric powder", "altha", "alta ")),
    ("CLEANING", ("detergent", "disinfectant", "phenyl", "harpic", "lizol", "vim ", "dishwash", "floor cleaner")),
    ("HEALTH", ("tablet", "capsule", "syrup", "ointment", "bandage", "vitamin", "ayurved")),
    ("BEVERAGE", (" juice", "drink", "tea ", "coffee", "cola", "soda", "beer", "wine", "whisky", "whiskey")),
    ("SNACKS", ("chips", "namkeen", "biscuit", "cookie", "chocolate", "candy", "wafer", "nasi goreng")),
    ("ELECTRONICS", ("bulb", "led ", "battery", "charger", "adapter", "extension", "switch")),
    ("HARDWARE", ("screw", "nail ", "hammer", "lock", "spanner", "wire ", "lighter", "gasket")),
    ("HOUSEHOLD", (
        "pan ", " fry pan", "saucepan", "cooker", "casserole", "uruli", "urali", "kadai",
        "tawa", "lid ", "tiffan", "tiffin", "plate", "container", "bowl", "spoon", "flask",
        "idli", "paniyaram", "gloves", "mould", "mold",
    )),
    ("PERSONAL_CARE", ("shampoo", "soap", "toothpaste", "lotion", "cream", "deodorant")),
    ("GROCERY", ("rice", "atta", "dal ", "dhal", "masala", "spice", "oil ", "flour", "sugar")),
    ("FOOD", ("milk", "bread", "egg", "curd", "yoghurt", "yogurt", "paneer", "cheese")),
]


def classify(ptype: str, title: str) -> str:
    t = (ptype or "").strip().upper()
    mapped = TYPE_MAP.get(t)
    hay = f"{ptype or ''} {title or ''}".lower()
    catchall = mapped in (None, "OTHER") or t in {
        "ACCESSORIES",
        "MISCELLANEOUS",
        "MISC",
        "ITEMS",
    }
    if catchall:
        for cat, keys in TITLE_RULES:
            if any(k in hay for k in keys):
                return cat
        return mapped or "OTHER"
    return mapped


def placeholder_url(cat: str) -> str:
    # Filename only — not a Windows path and not a live Shopify CDN URL.
    # Swap to a real HTTPS Files URL via Karthika_Placeholder_Mapping.csv after upload.
    return f"karthika-placeholder-{cat.lower()}.png"


def placeholder_file(cat: str) -> str:
    return f"{cat}.png"


def generate_assets() -> None:
    os.makedirs(ASSET_DIR, exist_ok=True)
    for cat in CATEGORIES:
        path = os.path.join(ASSET_DIR, placeholder_file(cat))
        make_placeholder(cat, path)
        print("wrote", path, os.path.getsize(path))


def process_csv() -> dict:
    with open(INPUT_CSV, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)

    img_col = "Product image URL"
    if img_col not in fieldnames:
        raise SystemExit("Missing Product image URL column")

    n = len(rows)
    skus = [(r.get("SKU") or "").strip() for r in rows]
    if n != 29718:
        print("WARN row count", n)
    if len(set(skus)) != n or any(s == "" for s in skus):
        raise SystemExit("SKU uniqueness failed")

    existing = 0
    assigned = 0
    still_blank = 0
    cat_counts: Counter[str] = Counter()
    map_rows = []
    out_rows = []

    for r in rows:
        new = dict(r)
        url = (r.get(img_col) or "").strip()
        if url:
            existing += 1
            out_rows.append(new)
            continue
        cat = classify(r.get("Type") or "", r.get("Title") or "")
        cat_counts[cat] += 1
        assigned += 1
        new[img_col] = placeholder_url(cat)
        out_rows.append(new)
        map_rows.append(
            {
                "SKU": (r.get("SKU") or "").strip(),
                "Title": r.get("Title") or "",
                "Type": r.get("Type") or "",
                "Placeholder Category": cat,
                "Placeholder File": placeholder_file(cat),
            }
        )

    for r in out_rows:
        if not (r.get(img_col) or "").strip():
            still_blank += 1

    with open(OUT_CSV, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        w.writerows(out_rows)

    with open(OUT_MAP, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=["SKU", "Title", "Type", "Placeholder Category", "Placeholder File"],
        )
        w.writeheader()
        w.writerows(map_rows)

    # Verify input untouched and output invariants
    with open(INPUT_CSV, "r", encoding="utf-8-sig", newline="") as f:
        orig = list(csv.DictReader(f))
    assert len(orig) == n
    preserved = 0
    replaced = 0
    for a, b in zip(orig, out_rows):
        if (a.get(img_col) or "").strip():
            if (a.get(img_col) or "") != (b.get(img_col) or ""):
                replaced += 1
            else:
                preserved += 1
        for k in fieldnames:
            if k == img_col:
                continue
            if (a.get(k) or "") != (b.get(k) or ""):
                raise SystemExit(f"Product data changed on SKU {a.get('SKU')} field {k}")

    out_skus = [(r.get("SKU") or "").strip() for r in out_rows]
    assert len(out_rows) == n
    assert len(set(out_skus)) == n
    assert replaced == 0

    coverage = 100.0 * (n - still_blank) / n if n else 0
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        "Karthika 100% visual assignment report",
        f"Generated: {now}",
        "Shopify upload: NOT performed (stopped as requested).",
        "Input CSV: not modified.",
        "",
        "FINAL NUMBERS",
        f"1. Total products: {n}",
        f"2. Existing real / verified images preserved: {existing}",
        f"3. Placeholder images assigned: {assigned}",
        f"4. Products with any image URL in output CSV: {n - still_blank}",
        f"5. Products still without image: {still_blank}",
        f"6. Coverage percentage: {coverage:.2f}%",
        "",
        "NOTE ON INPUT vs PRIOR REPORT",
        "Prior report cited 10,895 verified images and 18,823 without.",
        f"This input file actually contains {existing} populated Product image URL values",
        f"and {assigned} blanks. All populated URLs were left unchanged.",
        "No existing real image was replaced.",
        "",
        "PLACEHOLDER CATEGORY COUNTS",
    ]
    for cat in CATEGORIES:
        lines.append(f"  {cat}: {cat_counts.get(cat, 0)}")
    lines += [
        f"  TOTAL placeholders: {sum(cat_counts.values())}",
        "",
        "ASSETS",
        f"  Folder: {ASSET_DIR}",
        "  One PNG per category (1200x1200), clearly labelled PLACEHOLDER.",
        "  Not a product photo. No fake brands or packaging.",
        "",
        "PRODUCT IMAGE URL POLICY",
        "  Verified HTTP image URLs were copied unchanged.",
        "  Blank URLs were filled with a filename only, e.g. karthika-placeholder-food.png",
        "  (not a local Windows path, not a live CDN URL).",
        "  Shopify cannot fetch those filenames until the PNGs are uploaded to Shopify Files.",
        "  Use Karthika_Placeholder_Mapping.csv to substitute real HTTPS URLs after upload.",
        "  Do not import this CSV into Shopify until that substitution is done.",
        "",
        "OUTPUT FILES",
        f"  {OUT_CSV}",
        f"  {OUT_MAP}",
        f"  {OUT_REPORT}",
        "",
        "VALIDATION",
        f"  Row count: {n} (expected 29718)",
        f"  Unique SKUs: {len(set(out_skus))}",
        f"  Existing images preserved: {preserved} (replaced: {replaced})",
        f"  Placeholders assigned: {assigned}",
        f"  Still without image: {still_blank}",
        "  Product data columns unchanged except blank Product image URL fills.",
        "  STOPPED before Shopify upload.",
    ]
    text = "\n".join(lines) + "\n"
    with open(OUT_REPORT, "w", encoding="utf-8") as f:
        f.write(text)
    print(text)
    return {
        "n": n,
        "existing": existing,
        "assigned": assigned,
        "still_blank": still_blank,
        "cat_counts": cat_counts,
        "preserved": preserved,
        "replaced": replaced,
    }


if __name__ == "__main__":
    generate_assets()
    process_csv()
