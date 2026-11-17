"""Genera icono/dictaflow-1024.png (ícono de la app) a partir de site/img/icon.svg.

Fondo a sangre (Android aplica su propia máscara) y las barras dentro de la zona segura del
ícono adaptativo (~66 % central). Uso: python3 android/icono/generar.py && cargo tauri icon …
"""
from pathlib import Path
from PIL import Image, ImageDraw

S = 4096                 # se dibuja a 4× y se reduce: bordes suaves
k = 1.6 * S / 1024       # 1 unidad del SVG (caja de 512) = 1.6 px en el PNG de 1024
cx, cy = 264, 256        # centro del grupo de barras en el SVG
BARRAS = [(108, 212, 40, 88), (176, 164, 40, 184), (244, 118, 40, 276), (312, 164, 40, 184), (380, 212, 40, 88)]

img = Image.new('RGBA', (S, S), '#3584e4')
d = ImageDraw.Draw(img)
for x, y, w, h in BARRAS:
    x0, y0 = S / 2 + (x - cx) * k, S / 2 + (y - cy) * k
    d.rounded_rectangle([x0, y0, x0 + w * k, y0 + h * k], radius=20 * k, fill='white')
img.resize((1024, 1024), Image.LANCZOS).save(Path(__file__).with_name('dictaflow-1024.png'))
