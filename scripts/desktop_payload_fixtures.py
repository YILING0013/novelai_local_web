"""Regenerate offline Rust parity fixtures from the retained 678d0f7 payload builder."""
import base64
import io
import json
from pathlib import Path
import sys
from PIL import Image

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "nai_flask"))
from api_utils.novelai_payload_builder import ALL_MODELS, INPAINTING_MODELS, build_novelai_payload, estimate_novelai_image_tool

out = io.BytesIO()
Image.new("RGB", (64, 128), (12, 34, 56)).save(out, "PNG")
image = base64.b64encode(out.getvalue()).decode("ascii")
cases = []
for model in sorted(ALL_MODELS):
    common = dict(model=model, positivePrompt="fixture", negativePrompt="no text", seed=19, width=512, height=512, steps=24)
    scenarios = [{}, {"action": True, "image": image, "strength": .6, "noise": .1},
                 {"width": 2050, "height": 1537, "steps": 48}, {"width": 1024, "height": 1216, "use_upscale_credits": True}]
    if model in INPAINTING_MODELS:
        scenarios.append({"action": True, "image": image, "mask": image, "inpaint_strength": .65})
    if "diffusion-4" in model:
        scenarios.append({"characterPrompts": [{"prompt": "hero", "uc": "blur", "center": {"x": .4, "y": .8}}], "v4_prompt_char_captions": [{"char_caption":"hero"}], "use_coords":True})
    for opts in scenarios:
        request = {**common, **opts}
        result = build_novelai_payload(request.copy(), "local", 999, bool(opts.get("use_upscale_credits")), 140)
        cases.append({"input":request,"expected":result["data"]})
costs=[]
for model in sorted(ALL_MODELS):
    for width,height,amount in [(64,128,1),(512,768,1.5),(832,1216,"max")]:
        if amount=="max" and "diffusion-5" not in model: continue
        request=dict(model=model,image_tool="enhance",upscale_amount=amount,source_width=width,source_height=height)
        expected=estimate_novelai_image_tool(request,width,height)
        costs.append({"input":request,"expected":expected})
path=root/"src-tauri/tests/fixtures/official-payloads.json"
path.parent.mkdir(parents=True,exist_ok=True)
path.write_text(json.dumps({"generation":cases,"estimate":costs},ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf-8")
print(f"{len(cases)} generation payloads, {len(costs)} tool estimates")
