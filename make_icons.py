from PIL import Image, ImageDraw
def icon(size, path):
    S=size*4
    im=Image.new('RGB',(S,S),'#c4572e'); d=ImageDraw.Draw(im)
    d.ellipse([S*0.30,S*0.18,S*0.70,S*0.58],fill='#f4c25b')
    d.polygon([(0,S*0.62),(S*0.35,S*0.48),(S*0.7,S*0.60),(S,S*0.50),(S,S),(0,S)],fill='#e9b07a')
    d.polygon([(0,S*0.78),(S*0.45,S*0.62),(S,S*0.80),(S,S),(0,S)],fill='#f6efe4')
    # strada
    d.polygon([(S*0.44,S*0.66),(S*0.56,S*0.66),(S*0.78,S),(S*0.22,S)],fill='#3b2e24')
    for y0 in (0.70,0.80,0.91):
        w=0.006+0.02*(y0-0.66)
        d.rectangle([S*(0.5-w),S*y0,S*(0.5+w),S*(y0+0.045)],fill='#f6efe4')
    im.resize((size,size),Image.LANCZOS).save(path)
icon(192,'public/icon-192.png'); icon(512,'public/icon-512.png')
