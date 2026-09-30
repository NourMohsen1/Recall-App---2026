import torch, json
from transformers import AutoModel, AutoProcessor

NAME = "google/siglip2-base-patch16-224"
model = AutoModel.from_pretrained(NAME, attn_implementation="eager").eval()
proc = AutoProcessor.from_pretrained(NAME)

# (id, label shown, group, what the model is asked about)
V = [
    # places
    ("beach", "the beach", "place", "a beach by the sea"),
    ("park", "a park", "place", "a green park with trees"),
    ("mountains", "the mountains", "place", "mountains and hiking trails"),
    ("waterfall", "a waterfall", "place", "a waterfall in nature"),
    ("forest", "a forest", "place", "a forest"),
    ("desert", "the desert", "place", "a desert"),
    ("lake", "the water", "place", "a lake or a river"),
    ("city_street", "a city street", "place", "a busy city street"),
    ("night_city", "the city at night", "place", "a city street at night with lights"),
    ("rooftop", "a rooftop", "place", "a rooftop view over the city"),
    ("restaurant", "a restaurant", "place", "inside a restaurant"),
    ("cafe", "a café", "place", "inside a coffee shop"),
    ("bar", "a bar", "place", "a bar or a lounge at night"),
    ("home", "home", "place", "a living room at home"),
    ("kitchen", "a kitchen", "place", "a kitchen at home"),
    ("bedroom", "a bedroom", "place", "a bedroom"),
    ("office", "the office", "place", "an office with desks and computers"),
    ("classroom", "a classroom", "place", "a classroom or a lecture hall"),
    ("library", "a library", "place", "a library with bookshelves"),
    ("campus", "a campus", "place", "a university campus building"),
    ("gym", "the gym", "place", "a gym with workout machines"),
    ("stadium", "a stadium", "place", "a sports stadium"),
    ("football_pitch", "a football pitch", "place", "a football pitch with artificial grass"),
    ("mall", "a mall", "place", "a shopping mall"),
    ("supermarket", "a supermarket", "place", "a supermarket aisle"),
    ("hospital", "a hospital", "place", "a hospital or a doctor's office"),
    ("mosque", "a mosque", "place", "a mosque"),
    ("church", "a church", "place", "a church"),
    ("airport", "an airport", "place", "an airport terminal"),
    ("airplane", "a plane", "place", "inside an airplane or a view from a plane window"),
    ("car", "a car", "place", "inside a car"),
    ("train", "a train", "place", "a train or a subway"),
    ("hotel", "a hotel", "place", "a hotel room"),
    ("museum", "a museum", "place", "a museum or an art gallery"),
    ("concert", "a concert", "place", "a concert with a stage and lights"),
    ("cinema", "the cinema", "place", "a movie theater"),
    ("pool", "a pool", "place", "a swimming pool"),
    ("snow", "snow", "place", "snow and winter"),
    ("sunset", "a sunset", "place", "a sunset or a sunrise"),
    ("store", "a shop", "place", "a small shop or a storefront"),
    # activities
    ("eating", "a meal", "activity", "people eating a meal together"),
    ("cooking", "cooking", "activity", "someone cooking food"),
    ("coffee", "coffee", "activity", "a cup of coffee"),
    ("working_laptop", "working on a laptop", "activity", "working on a laptop"),
    ("studying", "studying", "activity", "studying with books and notes"),
    ("reading", "reading", "activity", "reading a book"),
    ("working_out", "working out", "activity", "a person working out"),
    ("running", "running", "activity", "running outdoors"),
    ("football", "football", "activity", "playing football"),
    ("basketball", "basketball", "activity", "playing basketball"),
    ("swimming", "swimming", "activity", "swimming"),
    ("hiking", "hiking", "activity", "hiking outdoors"),
    ("cycling", "cycling", "activity", "riding a bicycle"),
    ("driving", "driving", "activity", "driving a car"),
    ("shopping", "shopping", "activity", "shopping for clothes"),
    ("dancing", "dancing", "activity", "people dancing"),
    ("praying", "praying", "activity", "praying"),
    ("gaming", "gaming", "activity", "playing video games"),
    ("watching_tv", "watching TV", "activity", "watching tv at home"),
    ("music", "playing music", "activity", "playing a musical instrument"),
    ("selfie", "a selfie", "activity", "a selfie"),
    ("group_photo", "a group photo", "activity", "a group photo of friends"),
    ("walking", "a walk", "activity", "walking in the street"),
    ("travel", "travelling", "activity", "travelling with luggage"),
    ("presentation", "a presentation", "activity", "giving a presentation"),
    ("meeting", "a meeting", "activity", "a work meeting around a table"),
    ("painting", "drawing", "activity", "drawing or painting"),
    # events
    ("birthday", "a birthday", "event", "a birthday party with a cake and candles"),
    ("wedding", "a wedding", "event", "a wedding"),
    ("graduation", "a graduation", "event", "a graduation ceremony"),
    ("party", "a party", "event", "a party with friends"),
    ("family_gathering", "family time", "event", "a family gathering at home"),
    ("holiday_decor", "a holiday", "event", "festive holiday decorations"),
    ("ramadan", "Ramadan", "event", "a Ramadan iftar table"),
    ("eid", "Eid", "event", "an Eid celebration"),
    ("christmas", "Christmas", "event", "a Christmas tree"),
    ("picnic", "a picnic", "event", "a picnic outdoors"),
    ("bbq", "a barbecue", "event", "a barbecue grill"),
    ("fireworks", "fireworks", "event", "fireworks in the sky"),
    ("match", "a match", "event", "watching a football match"),
    # things
    ("pizza", "pizza", "thing", "a pizza"),
    ("burger", "a burger", "thing", "a burger"),
    ("sushi", "sushi", "thing", "sushi"),
    ("dessert", "dessert", "thing", "a dessert or a cake"),
    ("drink", "a drink", "thing", "a cold drink or a cocktail"),
    ("flowers", "flowers", "thing", "flowers"),
    ("gift", "a gift", "thing", "a wrapped gift"),
    ("dog", "a dog", "thing", "a dog"),
    ("cat", "a cat", "thing", "a cat"),
    ("baby", "a baby", "thing", "a baby"),
    ("kids", "kids", "thing", "children playing"),
    ("books", "books", "thing", "a stack of books"),
    ("clothes", "clothes", "thing", "clothes and shoes"),
    ("parked_car", "a car", "thing", "a parked car"),
    ("receipt", "a receipt", "thing", "a receipt or a bill"),
    ("document", "a document", "thing", "a printed document"),
    ("whiteboard", "a whiteboard", "thing", "a whiteboard with writing"),
    ("screen", "a screen", "thing", "a photo of a computer screen"),
    ("chat_screenshot", "a chat", "thing", "a screenshot of a chat conversation"),
    ("meme", "a meme", "thing", "a meme with text"),
    ("tv_show", "a TV show", "thing", "a scene from a tv show or a movie"),
    ("magazine", "a magazine", "thing", "a magazine cover"),
    ("map", "a map", "thing", "a map"),
    ("food_plate", "food", "thing", "a plate of food"),
    ("medicine", "medicine", "thing", "pills and medicine"),
    ("art", "art", "thing", "a painting or artwork"),
    ("plants", "plants", "thing", "house plants"),
    ("sky", "the sky", "thing", "the sky and clouds"),
]

prompts = [f"This is a photo of {p}." for (_, _, _, p) in V]
with torch.no_grad():
    t = proc(text=prompts, padding="max_length", max_length=64, return_tensors="pt")
    f = model.get_text_features(**t)
    f = f.pooler_output if hasattr(f, "pooler_output") else f
    f = f / f.norm(dim=-1, keepdim=True)

cal = json.load(open("ml/calibration.json"))
out = {
    "model": "siglip2-base-patch16-224",
    "logit_scale": cal["logit_scale"],
    "logit_bias": cal["logit_bias"],
    "concepts": [
        {"id": i, "label": l, "group": g, "e": [round(float(x), 5) for x in f[k]]}
        for k, (i, l, g, _) in enumerate(V)
    ],
}
json.dump(out, open("ml/vocab.json", "w"))
print(len(V), "concepts,", f.shape[1], "dims")
