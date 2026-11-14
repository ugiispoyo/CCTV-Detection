# Training gabungan crop + full-frame dan deployment hybrid YOLO

Panduan ini adalah prosedur lengkap untuk membuat model custom terbaru dari dua
sumber data:

1. dataset crop hasil annotation dan export Dashboard; dan
2. full-frame CCTV yang sudah direview dan diberi label.

Hasil training custom dipakai bersama model YOLO lama dalam mode hybrid:

```text
Satu full frame dari RTSP
├── custom best.pt  -> person, head, motorcycle
└── yolo26n.pt      -> car
```

Hybrid pada project ini bukan voting atau averaging dua model. Model custom
menjadi satu-satunya sumber `person`, `head`, dan `motorcycle`; model lama
menjadi satu-satunya sumber `car`. Pembagian class ini mencegah box ganda.

Panduan ini hanya menjelaskan training detector objek. Nama resident, alamat,
dan data identitas tidak menjadi class model.

## 1. Kondisi awal saat panduan dibuat

Export terbaru yang sudah berhasil dibuat adalah `v298`:

| Isi v298 | Jumlah |
| --- | ---: |
| Image | 228 |
| Train image | 142 |
| Validation image | 86 |
| Person box | 224 |
| Head box | 224 |
| Motorcycle box | 60 |
| Tracking session | 36 |

Mapping export canonical adalah:

```text
0 person
1 head
2 car
3 motorcycle
```

Folder berikut juga sudah tersedia:

```text
data/full-frame-assets/day-v1/images/all-frame-conditions/
```

Folder tersebut sekarang berisi 137 full-frame native dari dua lens dan kondisi
siang/malam. Baseline label yang sudah direview tersedia di
`data/full-frame-assets/all-frame-conditions-labeled-v1/`. Dataset canonical,
subset custom, dan gabungan dengan crop v298 juga sudah disiapkan:

```text
data/datasets/full-frame-conditions-v1/
data/datasets/full-frame-conditions-v1-person-head-motorcycle/
data/datasets/vehicle-person-detector/v298-person-head-motorcycle/
data/datasets/v298-plus-full-frame-phm-v1/
```

Dataset gabungan berisi 365 image, 800 annotation `person/head/motorcycle`, dan
54 negative image. Pembuatan dataset ini tidak menjalankan training.

Jangan memakai regression frame sebagai training frame. Jika model pernah
melihat frame tersebut saat training, hasil regression tidak lagi independen.

## 2. Target dataset sebelum mulai training utama

Target awal yang disarankan untuk full-frame adalah:

| Kegunaan | Target minimum |
| --- | ---: |
| Training full-frame kosong/hard-negative | 20–30 frame |
| Training person | 30–50 frame |
| Training motorcycle | 30–50 frame |
| Training mixed person + motorcycle | 15–25 frame |
| Regression yang tidak masuk training | 40–80 frame |

Usahakan total 120–200 full-frame training yang benar-benar berbeda. Sebarkan
antara:

- lens 1 dan lens 2;
- siang, malam, hujan, dan jalan basah;
- person dekat, jauh, kecil, dan tertutup sebagian;
- motorcycle diam, bergerak, dengan dan tanpa pengendara;
- background kosong, mobil, pagar, tanaman, bayangan, dan hewan;
- beberapa event berbeda, bukan puluhan frame berurutan dari satu event.

Frame berurutan dari event yang sama harus memakai `group` yang sama. Hal ini
mencegah satu event masuk train dan validation sekaligus.

## 3. Siapkan terminal dan environment

Dari project root:

```bash
cd /Users/ugiispoyowidodo/Data/pribadi/cv/cctv-detection/cv
source .venv/bin/activate
python -c "import torch; print('MPS available:', torch.backends.mps.is_available())"
```

Pada Apple Silicon, hasil ideal adalah:

```text
MPS available: True
```

Periksa file yang diperlukan:

```bash
test -f models/yolo26n.pt && echo "base model OK"
test -f data/datasets/vehicle-person-detector/v298/metadata.json && echo "v298 OK"
test -f data/datasets/vehicle-person-detector/v298/data.yaml && echo "v298 YAML OK"
```

Jangan menjalankan training dan CV realtime bersamaan pada MPS. Keduanya akan
berebut GPU dan dapat membuat RTSP preview tersendat.

## 4. Bekukan regression set terlebih dahulu

Sebelum memberi status `train`, pilih 40–80 full-frame untuk regression.
Regression set harus mencakup minimal:

- 10 frame kosong;
- 10 frame person;
- 10 frame motorcycle;
- kedua lens;
- siang dan malam.

Simpan daftar regression sejak awal. Setelah dibekukan, jangan memindahkan frame
tersebut ke training hanya karena hasil model pada frame itu kurang bagus.
Kegagalan pada regression harus diperbaiki memakai frame lain dari event/sesi
lain.

Semua 137 frame pada baseline label v1 saat ini dialokasikan untuk kandidat
training/validation dan dikelompokkan per event. Karena itu frame tersebut
belum menjadi regression set independen. Ambil sesi lain yang tidak overlap
untuk membuat regression set 40–80 frame; jangan mengambilnya dari dataset
gabungan yang sudah disiapkan.

## 5. Siapkan working directory full-frame

Buat lokasi kerja terpisah agar file sumber tidak berubah:

```bash
mkdir -p data/full-frame-assets/hybrid-v1/incoming
mkdir -p data/full-frame-assets/hybrid-v1/labels
```

Normalisasikan full-frame ke ekstensi `.jpg`. Validator training saat ini
mengharapkan pasangan image training berakhiran `.jpg`:

```bash
for image in data/full-frame-assets/day-v1/images/all-frame-conditions/*.jpeg; do
  name="$(basename "$image" .jpeg)"
  sips -s format jpeg "$image" \
    --out "data/full-frame-assets/hybrid-v1/incoming/${name}.jpg" >/dev/null
done
```

Untuk hasil terbaik, tambahkan full-frame native dari RTSP, bukan hanya gambar
yang sudah dikompresi WhatsApp. Objek kecil lebih mudah rusak oleh resize dan
kompresi.

## 6. Beri label semua full-frame

Setiap image harus memiliki satu file `.txt` dengan nama stem yang sama:

```text
incoming/frame-001.jpg
labels/frame-001.txt
```

Format setiap baris adalah YOLO normalized:

```text
class_id x_center y_center width height
```

Gunakan mapping canonical berikut saat memberi label full-frame:

```text
0 person
1 head
2 car
3 motorcycle
```

Contoh satu frame yang berisi person, head, motorcycle, dan car:

```text
0 0.510000 0.520000 0.180000 0.620000
1 0.515000 0.245000 0.060000 0.090000
3 0.600000 0.700000 0.310000 0.260000
2 0.210000 0.610000 0.300000 0.230000
```

Untuk frame tanpa `person`, `head`, `car`, atau `motorcycle`, buat file label
kosong. Jangan menulis spasi atau komentar:

```bash
touch data/full-frame-assets/hybrid-v1/labels/frame-empty-001.txt
```

Aturan annotation:

1. Box harus rapat mengelilingi bagian objek yang terlihat.
2. `person` mengelilingi tubuh, bukan seluruh crop/frame.
3. `head` mengelilingi kepala, bukan upper body.
4. `motorcycle` hanya mengelilingi motor, bukan pengendara dan background.
5. `car` tetap dilabel pada dataset canonical walaupun nanti dikeluarkan dari
   subset custom. Label ini diperlukan untuk regression hybrid yang benar.
6. Semua objek target yang jelas pada image training wajib dilabel. Objek yang
   dibiarkan tanpa label akan diperlakukan sebagai background oleh training.
7. Jika target terlalu ambigu untuk diberi box konsisten, jangan pakai frame itu
   untuk training. Letakkan sebagai review/regression terpisah.
8. Jangan membuat label kosong hanya karena model lama gagal mendeteksi objek.
9. Periksa terutama person kecil di ujung jalan dan motorcycle di balik pagar.

## 7. Buat manifest full-frame

Salin template:

```bash
cp config/full-frame-baseline.example.json \
  data/full-frame-assets/hybrid-v1/manifest.json
```

Edit `data/full-frame-assets/hybrid-v1/manifest.json`. Contoh:

```json
{
  "classMapping": {
    "person": 0,
    "head": 1,
    "car": 2,
    "motorcycle": 3
  },
  "items": [
    {
      "image": "incoming/lens-1-day-empty-001.jpg",
      "label": "labels/lens-1-day-empty-001.txt",
      "lens": "lens-1",
      "lighting": "day",
      "scene": "empty",
      "usage": "regression",
      "group": "lens-1-day-empty-session-001"
    },
    {
      "image": "incoming/lens-2-night-person-001.jpg",
      "label": "labels/lens-2-night-person-001.txt",
      "lens": "lens-2",
      "lighting": "night",
      "scene": "person",
      "usage": "train",
      "group": "lens-2-night-person-event-001"
    },
    {
      "image": "incoming/lens-1-day-motorcycle-001.jpg",
      "label": "labels/lens-1-day-motorcycle-001.txt",
      "lens": "lens-1",
      "lighting": "day",
      "scene": "motorcycle",
      "usage": "train",
      "group": "lens-1-day-motorcycle-event-001"
    },
    {
      "image": "incoming/lens-1-day-mixed-001.jpg",
      "label": "labels/lens-1-day-mixed-001.txt",
      "lens": "lens-1",
      "lighting": "day",
      "scene": "mixed",
      "usage": "train",
      "group": "lens-1-day-mixed-event-001"
    }
  ]
}
```

Nilai yang valid:

```text
lens     : lens-1 | lens-2
lighting : day | night
scene    : empty | person | motorcycle | mixed
usage    : train | regression
```

Gunakan `group` yang sama untuk semua frame berurutan dari satu kejadian.
Jangan memakai group yang sama untuk `train` dan `regression`.

## 8. Validasi dan bangun dataset full-frame

Setelah regression mencapai minimal 40 frame dan coverage-nya lengkap:

```bash
python scripts/prepare_full_frame_dataset.py \
  data/full-frame-assets/hybrid-v1/manifest.json \
  data/datasets/full-frame-hybrid-v1 \
  --enforce-regression-baseline
```

Script akan menolak:

- image atau label yang hilang;
- exact duplicate image;
- format label yang salah;
- box yang keluar dari frame;
- scene `empty` yang memiliki annotation;
- mapping class yang berubah;
- group yang menyeberang usage/split;
- regression baseline yang belum lengkap.

Output harus memiliki:

```text
data/datasets/full-frame-hybrid-v1/
├── images/train/
├── images/val/
├── images/regression/
├── labels/train/
├── labels/val/
├── labels/regression/
├── data.yaml
└── metadata.json
```

Periksa metadata:

```bash
cat data/datasets/full-frame-hybrid-v1/metadata.json
```

Pastikan `splitCounts` berisi `train`, `val`, dan `regression`. Jangan lanjut
jika `train` atau `val` kosong.

Jika full-frame belum mencapai baseline regression, jalankan tanpa flag hanya
untuk smoke validation struktur:

```bash
python scripts/prepare_full_frame_dataset.py \
  data/full-frame-assets/hybrid-v1/manifest.json \
  data/datasets/full-frame-hybrid-smoke-v1
```

Jangan gunakan dataset smoke yang coverage-nya belum lengkap untuk keputusan
deployment.

## 9. Buat subset custom dari crop v298

Model custom hanya melatih tiga class dengan mapping baru:

```text
0 person
1 head
2 motorcycle
```

Buat subset dari crop export terbaru:

```bash
python scripts/prepare_training_subset.py \
  data/datasets/vehicle-person-detector/v298 \
  data/datasets/vehicle-person-detector/v298-person-head-motorcycle \
  --classes person head motorcycle \
  --keep-empty
```

`--keep-empty` penting agar image yang tidak memiliki tiga class tersebut tetap
dapat berfungsi sebagai background negative.

Periksa mapping dan jumlahnya:

```bash
cat data/datasets/vehicle-person-detector/v298-person-head-motorcycle/data.yaml
cat data/datasets/vehicle-person-detector/v298-person-head-motorcycle/metadata.json
```

Mapping output wajib persis:

```text
0 person
1 head
2 motorcycle
```

Jangan mengubah export `v298` secara langsung. Folder turunan harus versioned dan
baru; script sengaja menolak overwrite.

## 10. Buat subset custom dari full-frame

Remap dataset full-frame canonical menjadi tiga class custom:

```bash
python scripts/prepare_training_subset.py \
  data/datasets/full-frame-hybrid-v1 \
  data/datasets/full-frame-hybrid-v1-person-head-motorcycle \
  --classes person head motorcycle \
  --keep-empty
```

Hanya split `train` dan `val` yang disalin oleh script subset. Split
`regression` tetap berada di dataset canonical
`data/datasets/full-frame-hybrid-v1` dan tidak masuk training.

Periksa metadata:

```bash
cat data/datasets/full-frame-hybrid-v1-person-head-motorcycle/metadata.json
```

Pastikan `negativeImageCount` lebih dari nol. Negative full-frame adalah bagian
penting untuk menekan box palsu pada tembok, pagar, mobil, tanaman, hewan, dan
bayangan.

## 11. Gabungkan crop dan full-frame

Gabungkan dua subset yang mapping-nya sudah sama:

```bash
python scripts/merge_training_datasets.py \
  data/datasets/v298-plus-full-frame-phm-v1 \
  --source data/datasets/vehicle-person-detector/v298-person-head-motorcycle \
  --source data/datasets/full-frame-hybrid-v1-person-head-motorcycle
```

Merge akan:

- mempertahankan split train/val dari masing-masing sumber;
- menambahkan prefix pada filename agar tidak bertabrakan;
- menolak class mapping yang berbeda;
- menolak exact duplicate image di source atau split lain;
- mencatat provenance kedua dataset;
- mempertahankan empty label.

Periksa hasil merge:

```bash
cat data/datasets/v298-plus-full-frame-phm-v1/data.yaml
cat data/datasets/v298-plus-full-frame-phm-v1/metadata.json
find data/datasets/v298-plus-full-frame-phm-v1/images/train -type f | wc -l
find data/datasets/v298-plus-full-frame-phm-v1/images/val -type f | wc -l
find data/datasets/v298-plus-full-frame-phm-v1/labels/train -type f | wc -l
find data/datasets/v298-plus-full-frame-phm-v1/labels/val -type f | wc -l
```

Jumlah image dan label pada setiap split harus sama. Jangan lanjut jika merge
melaporkan duplicate atau mapping mismatch; perbaiki sumbernya, jangan mematikan
validasi.

## 12. Hentikan CV realtime

Pada terminal CV realtime tekan `Ctrl+C`, lalu pastikan worker berhenti:

```bash
ps aux | grep '[p]ython.*-m src.main'
```

Output harus kosong. Training dan realtime tidak boleh berbagi MPS pada tahap
ini.

## 13. Jalankan smoke training

Smoke training memeriksa seluruh pipeline dengan biaya lebih kecil:

```bash
DATASET_TRAINING_ENABLED=true python scripts/train_detector.py \
  data/datasets/v298-plus-full-frame-phm-v1 \
  --base-model models/yolo26n.pt \
  --version detector-v298-full-frame-phm-smoke-v1 \
  --class-names person head motorcycle \
  --epochs 5 \
  --imgsz 416 \
  --batch 8 \
  --patience 3 \
  --workers 0 \
  --seed 42 \
  --device mps
```

Smoke dianggap berhasil bila:

- tidak ada error class mapping;
- semua image memiliki label pasangan;
- tidak ada train/val exact leakage;
- training menghasilkan `weights/best.pt`;
- loss tidak menjadi `nan`.

Smoke model bukan kandidat deployment.

## 14. Jalankan training utama

Gunakan nama versi baru yang tidak pernah dipakai sebelumnya:

```bash
DATASET_TRAINING_ENABLED=true python scripts/train_detector.py \
  data/datasets/v298-plus-full-frame-phm-v1 \
  --base-model models/yolo26n.pt \
  --version detector-v298-full-frame-phm-hybrid-v1 \
  --class-names person head motorcycle \
  --epochs 80 \
  --imgsz 640 \
  --batch 8 \
  --patience 15 \
  --workers 0 \
  --seed 42 \
  --device mps
```

Jika MPS kehabisan memori, ulangi dengan versi baru dan turunkan batch:

```text
--batch 4
```

Jangan mengubah seed, image size, dataset, dan threshold sekaligus. Perubahan
satu faktor per eksperimen membuat hasil antar kandidat bisa dibandingkan.

Output utama:

```text
data/training-runs/detector-v298-full-frame-phm-hybrid-v1/
├── weights/best.pt
├── weights/last.pt
├── results.csv
├── args.yaml
└── training-metadata.json
```

Gunakan `best.pt`, bukan `last.pt`.

## 15. Evaluasi validation gabungan

```bash
python scripts/evaluate_detector.py \
  --model data/training-runs/detector-v298-full-frame-phm-hybrid-v1/weights/best.pt \
  --data data/datasets/v298-plus-full-frame-phm-v1/data.yaml \
  --device mps
```

Laporan tersimpan di:

```text
data/training-runs/detector-v298-full-frame-phm-hybrid-v1/weights/best.evaluation.json
```

Periksa:

```bash
cat data/training-runs/detector-v298-full-frame-phm-hybrid-v1/weights/best.evaluation.json
```

Bandingkan precision, recall, mAP50, dan mAP50-95 per class dengan kandidat
sebelumnya. Validation gabungan lebih representatif daripada crop-only, tetapi
belum menjadi keputusan akhir.

## 16. Jalankan full-frame regression yang dibekukan

Bandingkan legacy YOLO dengan hybrid candidate memakai full-frame yang tidak
pernah ikut training:

```bash
python scripts/evaluate_hybrid_regression.py \
  data/datasets/full-frame-hybrid-v1 \
  --legacy-model models/yolo26n.pt \
  --custom-model data/training-runs/detector-v298-full-frame-phm-hybrid-v1/weights/best.pt \
  --confidence 0.25 \
  --iou 0.50 \
  --match-iou 0.50 \
  --imgsz 640 \
  --device mps
```

Laporan default tersimpan di samping weight:

```text
best.full-frame-regression.json
```

Periksa:

```bash
cat data/training-runs/detector-v298-full-frame-phm-hybrid-v1/weights/best.full-frame-regression.json
```

Yang harus diperiksa:

- `hybrid.person.recall` tidak turun tanpa alasan;
- recall motorcycle membaik atau minimal tidak rusak;
- precision tidak jatuh karena background dianggap objek;
- jumlah `hybridFramesWithFalsePositive` pada empty frame tetap rendah;
- car dari legacy tetap terdeteksi;
- head masuk akal dan tidak muncul besar pada background.

Baseline acceptance awal yang disarankan:

| Pemeriksaan | Gate awal |
| --- | --- |
| Person recall | Tidak lebih buruk > 0.02 dari baseline yang disetujui |
| Motorcycle recall | Tidak turun; idealnya naik |
| Empty-frame false positive | Tidak lebih tinggi dari kandidat/baseline aktif |
| Car | Tidak berubah karena tetap berasal dari legacy YOLO |
| Head | Box berada pada kepala, bukan background/upper body besar |

Angka gate dapat diperketat setelah regression set bertambah. Jangan meloloskan
model hanya karena mAP crop tinggi.

## 17. Uji prediksi visual sebelum live

Gunakan inference Ultralytics pada beberapa full-frame terpisah untuk melihat
box secara manual:

```bash
yolo predict \
  model=data/training-runs/detector-v298-full-frame-phm-hybrid-v1/weights/best.pt \
  source=data/datasets/full-frame-hybrid-v1/images/regression \
  conf=0.25 \
  iou=0.50 \
  imgsz=640 \
  device=mps \
  project=data/prediction-reviews \
  name=detector-v298-full-frame-phm-hybrid-v1
```

Review output satu per satu. Cari box besar pada tembok, pagar, mobil, tanaman,
refleksi jalan basah, dan area gelap.

## 18. Konfigurasikan runtime hybrid

Edit `cv/.env` dan pertahankan YOLO lama sebagai sumber car:

```dotenv
MODEL_PATH=yolo26n.pt
EXPERIMENTAL_HYBRID_DETECTOR_ENABLED=true
CUSTOM_DETECTOR_MODEL_PATH=data/training-runs/detector-v298-full-frame-phm-hybrid-v1/weights/best.pt
DEVICE=mps
CONFIDENCE_THRESHOLD=0.25
IOU_THRESHOLD=0.50
IMAGE_SIZE=640
```

Validasi konfigurasi sebelum startup:

```bash
python -c 'from src.config import Settings; s=Settings(); print({"hybrid": s.EXPERIMENTAL_HYBRID_DETECTOR_ENABLED, "custom": str(s.custom_detector_model_path), "legacy_car": str(s.model_path), "confidence": s.CONFIDENCE_THRESHOLD, "iou": s.IOU_THRESHOLD})'
```

Pastikan output menunjukkan:

```text
hybrid: True
custom: .../detector-v298-full-frame-phm-hybrid-v1/weights/best.pt
legacy_car: .../models/yolo26n.pt
```

Gunakan threshold yang sama dengan regression. Jangan menurunkan confidence
setelah regression selesai tanpa mengulang regression, karena false positive
akan berubah.

## 19. Jalankan canary live

```bash
python -m src.main
```

Startup hybrid yang benar menampilkan ringkasan seperti:

```text
Model           : custom=best.pt (person, head, motorcycle); legacy=yolo26n.pt (car)
Object Classes  : person, head, motorcycle, car
Runtime         : headless
Dashboard preview: enabled
```

Pastikan hanya satu worker aktif:

```bash
ps aux | grep '[p]ython.*-m src.main'
```

Mode hybrid melakukan dua inference pass untuk setiap frame. Pantau latency,
FPS, suhu, dan queue selain akurasi.

## 20. Checklist live kedua lens

Uji secara terkontrol pada lens 1 dan lens 2:

1. Background kosong selama beberapa menit.
2. Person dekat dan jauh.
3. Person masuk dan keluar counting line.
4. Person tertutup sebagian.
5. Kepala besar, kecil, dan sebagian tertutup.
6. Motorcycle diam dan bergerak.
7. Motorcycle dengan dan tanpa pengendara.
8. Car untuk memastikan legacy detector tetap bekerja.
9. Pagar, tanaman, bayangan, hewan, dan refleksi jalan basah.
10. Kondisi siang dan malam.
11. FPS dan inference latency.
12. `queue_pending` dan pengiriman event/capture.

Label preview yang diharapkan:

```text
PERSON #track confidence
HEAD #track confidence
MOTORCYCLE #track confidence
CAR #track confidence
```

Hentikan canary bila:

- background sering dianggap person/motorcycle/head;
- person lama yang jelas justru hilang;
- motor tidak lebih baik dari kandidat sebelumnya;
- FPS terlalu rendah untuk tracking/counting;
- event queue terus bertambah;
- service tidak stabil pada salah satu lens.

## 21. Rollback

Hentikan worker dengan `Ctrl+C`, lalu ubah hanya:

```dotenv
EXPERIMENTAL_HYBRID_DETECTOR_ENABLED=false
```

Jalankan kembali:

```bash
python -m src.main
```

Rollback tidak menghapus dataset, weight, atau laporan kandidat. Jangan menimpa
`models/yolo26n.pt`; model tersebut adalah jalur car dan fallback yang stabil.

## 22. Siklus perbaikan berikutnya

Jika candidate gagal:

1. Catat frame dan jenis kegagalannya.
2. Jangan mengambil frame dari regression set untuk training.
3. Ambil contoh baru dari sesi lain dengan pola kegagalan serupa.
4. Beri label lengkap.
5. Tambahkan ke manifest dengan `usage: train` dan group baru.
6. Buat dataset version baru, misalnya `full-frame-hybrid-v2`.
7. Buat merge version baru, misalnya `v298-plus-full-frame-phm-v2`.
8. Train candidate version baru, jangan overwrite `v1`.
9. Jalankan internal validation dan regression yang sama.
10. Bandingkan laporan JSON sebelum live canary.

Struktur versioning yang disarankan:

```text
full-frame-hybrid-v1
full-frame-hybrid-v2
v298-plus-full-frame-phm-v1
v298-plus-full-frame-phm-v2
detector-v298-full-frame-phm-hybrid-v1
detector-v298-full-frame-phm-hybrid-v2
```

Jika ada export crop lebih baru dari `v298`, jangan mencampur folder secara
manual. Buat subset baru dari export tersebut, buat merged dataset baru, lalu
gunakan nama candidate baru.

## 23. Troubleshooting

### `Output already exists`

Script sengaja menolak overwrite. Gunakan suffix versi baru (`v2`, `v3`) atau
audit dan pindahkan output eksperimen lama. Jangan menghapus output yang sudah
menjadi baseline tanpa memastikan ada backup.

### `Dataset class mapping differs`

Pastikan kedua subset memakai:

```text
0 person
1 head
2 motorcycle
```

Jangan merge dataset canonical empat class langsung dengan subset tiga class.

### `Annotation has no matching image`

Pastikan image training memakai `.jpg`, nama stem image dan label sama, serta
jumlah file pada `images/<split>` sama dengan `labels/<split>`.

### `Duplicate image across datasets/splits`

Image yang sama ditemukan lebih dari sekali. Tentukan satu sumber dan satu split.
Jangan menyalin duplikat dengan nama berbeda.

### Regression baseline incomplete

Tambahkan regression frame sampai minimal 40, masing-masing minimal 10 untuk
empty, person, dan motorcycle, serta mencakup kedua lens dan day/night.

### MPS out of memory

Hentikan CV realtime, pastikan tidak ada training lain, lalu turunkan batch dari
8 menjadi 4. Gunakan version name baru untuk percobaan ulang.

### Validation bagus tetapi live buruk

Biasanya full-frame terlalu sedikit, terlalu mirip, atau annotation background
tidak cukup. Tambahkan hard-negative dan positive dari event lain. Jangan hanya
menurunkan confidence karena itu biasanya menambah false positive.

### Car hilang pada hybrid

Periksa bahwa:

```dotenv
MODEL_PATH=yolo26n.pt
EXPERIMENTAL_HYBRID_DETECTOR_ENABLED=true
```

Model custom tidak menyediakan car pada runtime hybrid; car selalu berasal dari
legacy YOLO.

## 24. Checklist akhir sebelum kandidat diterima

- [ ] Full-frame training dan regression sudah dipisah.
- [ ] Semua image memiliki label pasangan.
- [ ] Negative image memakai `.txt` kosong.
- [ ] Semua objek target jelas sudah dilabel.
- [ ] Frame berurutan memakai group yang sama.
- [ ] Kedua lens dan day/night terwakili.
- [ ] Crop subset mapping adalah `person/head/motorcycle = 0/1/2`.
- [ ] Full-frame subset mapping sama.
- [ ] Merge lolos tanpa duplicate/leakage.
- [ ] Smoke training berhasil.
- [ ] Main training menghasilkan `best.pt`.
- [ ] Internal validation sudah disimpan.
- [ ] Frozen full-frame regression sudah dijalankan.
- [ ] Empty-frame false positive sudah diperiksa.
- [ ] Person, head, motorcycle, dan legacy car diuji live.
- [ ] FPS/latency dua inference pass masih layak.
- [ ] Rollback sudah diuji.

