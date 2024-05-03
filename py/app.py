from flask import Flask, request
from PIL import Image
from transformers import AutoModelForImageClassification, AutoImageProcessor
import torch

image_processor = AutoImageProcessor.from_pretrained("samokosik/finetuned-clothes")
model = AutoModelForImageClassification.from_pretrained("samokosik/finetuned-clothes")


app = Flask(__name__)

@app.route("/upload", methods=['POST'])
def root():
    output = []
    for file in request.files.getlist("photos"):
        image = Image.open(file)
        encoding = image_processor(image.convert("RGB"),return_tensors="pt")
        with torch.no_grad():
            outputs = model(**encoding)
            logits = outputs.logits
        predicted_class_idx = logits.argmax(-1).item()
        output.append(model.config.id2label[predicted_class_idx])
    return ", ".join(output)
