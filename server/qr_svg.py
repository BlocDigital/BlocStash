import sys
from qrcode import QRCode
from qrcode.constants import ERROR_CORRECT_M
from qrcode.image.svg import SvgPathImage
url=sys.stdin.read()
q=QRCode(version=None,error_correction=ERROR_CORRECT_M,box_size=8,border=4)
q.add_data(url)
q.make(fit=True)
img=q.make_image(image_factory=SvgPathImage)
sys.stdout.buffer.write(img.to_string())
