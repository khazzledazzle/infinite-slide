#!/usr/bin/env python3
"""Rebuild dist/ from the live files: one self-contained HTML file and a zip of the site.
Run after every change:  python3 build.py"""
import base64, json, mimetypes, os, re, zipfile

here = os.path.dirname(os.path.abspath(__file__))
os.chdir(here)
read = lambda p: open(p, encoding='utf-8').read()
def data_uri(p):
    mime = mimetypes.guess_type(p)[0] or 'application/octet-stream'
    return 'data:%s;base64,%s' % (mime, base64.b64encode(open(p, 'rb').read()).decode())

html = read('index.html')
icon = data_uri('icon-180.png')
html = html.replace('<link rel="manifest" href="manifest.webmanifest">\n', '')
html = html.replace('href="icon-180.png"', 'href="%s"' % icon)
html = re.sub(r'<link rel="stylesheet" href="([^"]+)">',
              lambda m: '<style>\n%s\n</style>' % read(m.group(1)), html)
# Pictures used by the home-screen guide, embedded so the single file needs nothing else.
imgs = {f: data_uri('a2hs/img/' + f) for f in sorted(os.listdir('a2hs/img'))}
imgs['icon-180.png'] = icon
first = [True]
def inline(m):
    pre = ''
    if first[0]:
        first[0] = False
        pre = '<script>window.A2HS_IMG = %s;</script>\n' % json.dumps(imgs)
    return pre + '<script>\n%s\n</script>' % read(m.group(1)).replace('</script', '<\\/script')
html = re.sub(r'<script src="([^"]+)"></script>', inline, html)
assert 'src="' not in html.split('<body>')[0] and '<script src=' not in html and 'rel="stylesheet"' not in html

os.makedirs('dist', exist_ok=True)
open('dist/infinite-slide.html', 'w', encoding='utf-8').write(html)

site = ['index.html', 'shader.js', 'audio.js', 'main.js', 'manifest.webmanifest',
        'icon-180.png', 'icon-512.png', 'README.md']
for d, _, fs in os.walk('a2hs'):
    site += [os.path.join(d, f) for f in sorted(fs) if f != '.DS_Store']
with zipfile.ZipFile('dist/infinite-slide-site.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for f in site: z.write(f)
print('built dist/infinite-slide.html (%d KB) and dist/infinite-slide-site.zip (%d files)'
      % (len(html) // 1024, len(site)))
