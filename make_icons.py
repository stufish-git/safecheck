#!/usr/bin/env python3
"""Generate simple PWA icons for SafeChecks"""
import os, struct, zlib

def create_png(size, filename):
    """Create a minimal valid PNG with the SafeChecks checkmark"""
    # We'll create a simple colored square PNG
    w = h = size
    
    # Create pixel data - dark background with green checkmark area
    pixels = []
    for y in range(h):
        row = []
        for x in range(w):
            # Background color: #0d1117
            r, g, b = 13, 17, 23
            
            # Draw rounded rect background
            margin = size // 8
            if margin < x < w - margin and margin < y < h - margin:
                r, g, b = 22, 27, 34  # #161b22
            
            # Draw a simple checkmark shape in green (#22c55e)
            cx, cy = w // 2, h // 2
            # Simple check: two lines
            check_w = size // 3
            # Left part of check (going down-left to center)
            lx1, ly1 = cx - check_w // 2, cy
            lx2, ly2 = cx - check_w // 6, cy + check_w // 3
            # Right part (going up from center to top-right)
            rx1, ry1 = cx - check_w // 6, cy + check_w // 3
            rx2, ry2 = cx + check_w // 2, cy - check_w // 3
            
            thickness = max(2, size // 24)
            
            def dist_to_segment(px, py, x1, y1, x2, y2):
                dx, dy = x2 - x1, y2 - y1
                if dx == 0 and dy == 0:
                    return ((px-x1)**2 + (py-y1)**2) ** 0.5
                t = max(0, min(1, ((px-x1)*dx + (py-y1)*dy) / (dx*dx + dy*dy)))
                return ((px - (x1 + t*dx))**2 + (py - (y1 + t*dy))**2) ** 0.5
            
            d1 = dist_to_segment(x, y, lx1, ly1, lx2, ly2)
            d2 = dist_to_segment(x, y, rx1, ry1, rx2, ry2)
            
            if d1 < thickness or d2 < thickness:
                r, g, b = 34, 197, 94  # green
            
            row.extend([r, g, b, 255])
        pixels.append(row)
    
    # Build PNG
    def make_chunk(chunk_type, data):
        c = chunk_type + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    
    # IHDR
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    
    # IDAT
    raw = b''
    for row in pixels:
        raw += b'\x00' + bytes(row)
    compressed = zlib.compress(raw)
    
    png = b'\x89PNG\r\n\x1a\n'
    png += make_chunk(b'IHDR', ihdr)
    png += make_chunk(b'IDAT', compressed)
    png += make_chunk(b'IEND', b'')
    
    os.makedirs(os.path.dirname(filename), exist_ok=True)
    with open(filename, 'wb') as f:
        f.write(png)
    print(f"Created {filename} ({size}x{size})")

create_png(192, '/home/claude/FoodSafetyApp/icons/icon-192.png')
create_png(512, '/home/claude/FoodSafetyApp/icons/icon-512.png')
print("Icons created!")
