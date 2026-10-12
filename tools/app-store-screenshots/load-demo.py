# Writes the demo store into the simulator's copy of Recall, in the same
# layout React Native's AsyncStorage uses on iOS: small values inline in
# manifest.json, larger ones in a file named by the MD5 of their key.
import hashlib, json, os, sys
container, store_path = sys.argv[1], sys.argv[2]
store = json.load(open(store_path))
store.update({
    'onboardingComplete': 'true',
    'quizAnswers': json.dumps([[], ['daily', 'weekly'], ['off']]),
    'myPhotoCardDismissed': '1',
    'photoReading': 'chosen',
    'positiveFocus': 'false',
})
folder = os.path.join(container, 'Library', 'Application Support', 'com.nourwalid.recall', 'RCTAsyncLocalStorage_V1')
os.makedirs(folder, exist_ok=True)
for f in os.listdir(folder):
    os.remove(os.path.join(folder, f))
manifest = {}
for k, v in store.items():
    if len(v) > 1024:
        open(os.path.join(folder, hashlib.md5(k.encode()).hexdigest()), 'w').write(v)
        manifest[k] = None
    else:
        manifest[k] = v
json.dump(manifest, open(os.path.join(folder, 'manifest.json'), 'w'), ensure_ascii=False)
print(len(manifest), 'keys written to', folder)
