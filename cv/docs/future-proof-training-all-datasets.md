# Master guideline training semua jenis dataset dan hybrid YOLO

Dokumen ini adalah panduan baru yang berdiri sendiri. Panduan lama tidak diubah.
Tujuannya adalah menyediakan prosedur yang dapat dipakai berulang kali untuk:

1. training dari dataset crop saja;
2. training dari dataset full-frame saja;
3. training dari gabungan crop + full-frame;
4. menjalankan hasil crop + full-frame bersama YOLO dalam mode hybrid;
5. mengulang seluruh proses ketika ada gambar atau dataset versi baru.

Dokumen ini tidak menjalankan training. Semua perintah training di bawah adalah
instruksi untuk dijalankan operator ketika memang sudah siap.

---

## 1. Hasil akhir yang ingin dicapai

Arsitektur produksi yang direkomendasikan:

```text
Satu full-frame RTSP
├── custom best.pt -> person, head, motorcycle
└── yolo26n.pt     -> car
```

Custom model dilatih dengan dataset crop, full-frame, atau gabungan keduanya.
YOLO lama tetap menjadi detector `car` yang stabil.

Penting: `crop + full + YOLO` bukan berarti tiga dataset atau dua file weight
digabung menjadi satu `.pt`. Ada dua penggunaan YOLO yang berbeda:

- saat training, `models/yolo26n.pt` dapat menjadi pretrained starting weight;
- saat runtime hybrid, `models/yolo26n.pt` berjalan sebagai detector `car`
  berdampingan dengan custom model.

Tidak ada weight averaging, voting, atau penggabungan file `.pt`.

---

## 2. Empat jalur yang didukung

| Jalur | Dataset training | Output | Penggunaan |
| --- | --- | --- | --- |
| A. Crop-only | Crop export terbaru | Custom crop model | Baseline cepat dan pembanding |
| B. Full-only | Full-frame berlabel | Custom full-frame model | Eksperimen domain CCTV |
| C. Crop + full | Crop terbaru + full-frame | Custom mixed model | Kandidat custom utama |
| D. Crop + full + YOLO | Model jalur C + YOLO legacy | Dua model saat runtime | Rekomendasi produksi |

Untuk kondisi CCTV, jalur C lalu D biasanya paling masuk akal. Crop memberi box
person/head yang detail. Full-frame mengajarkan skala objek nyata, background,
dua lens, siang/malam, dan negative sample. YOLO legacy mempertahankan car.

---

## 3. Kondisi repository saat panduan dibuat

### 3.1 Crop terbaru

```text
data/datasets/vehicle-person-detector/v358/
data/datasets/vehicle-person-detector/v358-person-head-motorcycle/
```

Raw v358:

- 315 image;
- 681 annotation;
- 41 tracking session;
- mapping canonical `person=0`, `head=1`, `car=2`, `motorcycle=3`.

Subset v358 custom:

- 315 image;
- 681 annotation;
- 198 train dan 117 validation;
- mapping custom `person=0`, `head=1`, `motorcycle=2`.

### 3.2 Full-frame sekarang

```text
data/full-frame-assets/all-frame-conditions-labeled-v1/
data/datasets/full-frame-conditions-v1/
data/datasets/full-frame-conditions-v1-person-head-motorcycle/
```

Full-frame v1:

- 137 image;
- 144 person box;
- 48 head box;
- 55 car box pada dataset canonical;
- 100 motorcycle box;
- 54 negative image pada subset custom;
- 111 train dan 26 validation.

### 3.3 Dataset gabungan sekarang

```text
data/datasets/v358-plus-full-frame-phm-v1/
```

Isinya:

| Isi | Jumlah |
| --- | ---: |
| Total image | 452 |
| Total annotation | 973 |
| Negative image | 54 |
| Train image | 309 |
| Validation image | 143 |
| Train annotation | 667 |
| Validation annotation | 306 |

### 3.4 Training run v358 yang terlihat

```text
data/training-runs/detector-v358-phm-smoke-v1/
data/training-runs/detector-v358-phm-live-v1/
data/training-runs/detector-v358-full-frame-phm-smoke-v1/
data/training-runs/detector-v358-full-frame-phm-hybrid-v1/
```

Smoke crop dan smoke merged sudah memiliki `training-metadata.json`. Main
full-frame hybrid v1 memiliki weight pada saat audit, tetapi belum memiliki
`training-metadata.json`. Jangan menganggap run tersebut selesai atau layak
deployment hanya karena `weights/best.pt` sudah muncul.

### 3.5 Regression independen

Full-frame v1 saat ini memiliki:

```text
regressionImageCount: 0
regressionFrozen: false
```

Artinya belum ada regression set independen. Train/validation full-frame tidak
boleh disebut sebagai regression independen karena sudah ikut proses training.

---

## 4. Mapping class yang wajib dijaga

### 4.1 Mapping canonical

Raw export crop dan full-frame canonical memakai:

```text
0 person
1 head
2 car
3 motorcycle
```

Mapping ini dipakai untuk annotation, provenance, dan dataset master.

### 4.2 Mapping custom hybrid

Custom model yang dipasang pada runtime hybrid wajib memakai:

```text
0 person
1 head
2 motorcycle
```

Class harus contiguous. Motorcycle berubah dari canonical ID `3` menjadi custom
ID `2` setelah `car` dikeluarkan.

### 4.3 Mengapa raw export tidak boleh langsung dipasang ke hybrid

Pada raw export, class `2` berarti `car`. Pada runtime hybrid, class `2`
diharapkan sebagai `motorcycle`. Memasang raw model empat class sebagai
`CUSTOM_DETECTOR_MODEL_PATH` akan menghasilkan mapping salah dan ditolak oleh
runtime.

---

## 5. Aturan dataset yang tidak boleh dilanggar

1. Dataset yang pernah dipakai training bersifat immutable.
2. Jangan menambahkan file langsung ke folder v358 atau dataset version lama.
3. Setiap perubahan label atau image harus menghasilkan versi baru.
4. Semua objek target yang jelas dalam image harus diberi label.
5. Frame tanpa target harus memiliki file `.txt` kosong.
6. Frame berurutan dari event yang sama harus berada dalam group/split sama.
7. Jangan memasukkan image yang sama ke train dan validation.
8. Jangan memasukkan regression image ke training.
9. Jangan merge dua crop export kumulatif, misalnya v358 + v359.
10. Jangan menggunakan nama model yang tidak sesuai sumber dataset.
11. Jangan overwrite training run lama.
12. Gunakan `best.pt`, bukan `last.pt`, untuk evaluasi kandidat.

---

## 6. Pola versioning untuk masa depan

Gunakan pola berikut:

```text
Raw crop export:
  v359

Crop subset custom:
  v359-person-head-motorcycle

Full-frame canonical:
  full-frame-conditions-v2

Full-frame subset custom:
  full-frame-conditions-v2-person-head-motorcycle

Dataset merge:
  v359-plus-full-frame-phm-v2

Smoke model:
  detector-v359-full-frame-phm-smoke-v1

Main custom model:
  detector-v359-full-frame-phm-hybrid-v1

Fine-tune model:
  detector-v359-full-frame-phm-finetune-v1
```

Angka crop mengikuti export Dashboard. Angka full-frame mengikuti batch/manifest
full-frame. Angka terakhir pada model adalah nomor eksperimen untuk kombinasi
dataset yang sama.

---

## 7. Persiapan environment

Masuk ke folder CV:

```bash
cd /Users/ugiispoyowidodo/Data/pribadi/cv/cctv-detection/cv
source .venv/bin/activate
```

Periksa environment:

```bash
python --version
python -c "import ultralytics; print('Ultralytics:', ultralytics.__version__)"
python -c "import torch; print('MPS available:', torch.backends.mps.is_available())"
```

Periksa base model:

```bash
test -f models/yolo26n.pt && echo "base model OK"
```

Pada Apple Silicon, gunakan `--device mps` bila tersedia. Gunakan `--device cpu`
hanya bila MPS tidak tersedia.

Jangan menjalankan realtime CV dan training pada MPS secara bersamaan.

---

## 8. Hentikan realtime CV sebelum training

Pada terminal realtime tekan `Ctrl+C`, lalu periksa:

```bash
ps aux | grep '[p]ython.*-m src.main'
```

Output harus kosong. API dan Dashboard boleh tetap berjalan.

---

## 9. Checklist annotation crop

Sebelum export crop baru:

1. Buka Person Labeling.
2. Pilih capture yang masih memiliki source image.
3. Gambar box person rapat pada tubuh yang terlihat.
4. Gambar box head rapat pada kepala.
5. Gambar box motorcycle pada motor, bukan motor + pengendara.
6. Gambar car bila terlihat dan dataset canonical membutuhkannya.
7. Tambahkan semua objek target pada image, bukan hanya objek utama.
8. Simpan draft.
9. Review ulang.
10. Approve hanya box yang benar.
11. Export approved dataset.

Jangan memasukkan nama resident, alamat, atau identitas sebagai class YOLO.

---

## 10. Memilih crop export terbaru

Misalnya export baru adalah v359:

```bash
cat data/datasets/vehicle-person-detector/v359/metadata.json
cat data/datasets/vehicle-person-detector/v359/data.yaml
```

Periksa:

- class mapping canonical benar;
- `imageCount` dan `annotationCount` tidak nol;
- train dan validation tersedia;
- tracking session masuk akal;
- source image belum expired;
- tidak ada error export.

Jika v359 adalah export kumulatif yang sudah berisi sample v358, gunakan v359
saja. Jangan merge v358 dan v359.

---

## 11. Membuat subset crop custom

Contoh untuk v359:

```bash
python scripts/prepare_training_subset.py \
  data/datasets/vehicle-person-detector/v359 \
  data/datasets/vehicle-person-detector/v359-person-head-motorcycle \
  --classes person head motorcycle \
  --keep-empty
```

Fungsi script:

- membuang annotation car;
- remap motorcycle `3 -> 2`;
- mempertahankan split;
- mempertahankan car-only/background image sebagai negative bila
  `--keep-empty` dipakai;
- menyimpan provenance;
- menolak overwrite folder lama.

Periksa:

```bash
cat data/datasets/vehicle-person-detector/v359-person-head-motorcycle/data.yaml
cat data/datasets/vehicle-person-detector/v359-person-head-motorcycle/metadata.json
```

Mapping output wajib:

```text
0 person
1 head
2 motorcycle
```

---

## 12. Validasi dataset tanpa training

Crop subset:

```bash
python -c 'from pathlib import Path; from scripts.train_detector import validate_dataset; print(validate_dataset(Path("data/datasets/vehicle-person-detector/v359-person-head-motorcycle").resolve(), {0: "person", 1: "head", 2: "motorcycle"}))'
```

Validator memeriksa:

- `metadata.json`;
- `data.yaml`;
- mapping class;
- format YOLO;
- batas normalized box;
- pasangan image-label;
- exact duplicate antara train dan validation.

Jangan lanjut jika validator gagal.

---

## 13. Jalur A — training crop-only custom

### 13.1 Smoke crop-only

```bash
DATASET_TRAINING_ENABLED=true python scripts/train_detector.py \
  data/datasets/vehicle-person-detector/v359-person-head-motorcycle \
  --base-model models/yolo26n.pt \
  --version detector-v359-phm-smoke-v1 \
  --class-names person head motorcycle \
  --epochs 10 \
  --imgsz 416 \
  --batch 8 \
  --patience 4 \
  --workers 0 \
  --seed 42 \
  --device mps
```

Smoke sukses bila:

- tidak ada mapping error;
- tidak ada leakage error;
- loss bukan `nan`;
- `weights/best.pt` tersedia;
- `training-metadata.json` tersedia.

Smoke model bukan kandidat deployment.

### 13.2 Main crop-only

```bash
DATASET_TRAINING_ENABLED=true python scripts/train_detector.py \
  data/datasets/vehicle-person-detector/v359-person-head-motorcycle \
  --base-model models/yolo26n.pt \
  --version detector-v359-phm-live-v1 \
  --class-names person head motorcycle \
  --epochs 60 \
  --imgsz 640 \
  --batch 8 \
  --patience 12 \
  --workers 0 \
  --seed 42 \
  --device mps
```

Jika MPS kehabisan memori, buat version name baru dan turunkan hanya batch:

```text
--batch 4
```

### 13.3 Evaluasi crop-only

```bash
python scripts/evaluate_detector.py \
  --model data/training-runs/detector-v359-phm-live-v1/weights/best.pt \
  --data data/datasets/vehicle-person-detector/v359-person-head-motorcycle/data.yaml \
  --device mps
```

Model crop-only adalah baseline. Jangan menyimpulkan performa full-frame hanya
dari crop validation.

---

## 14. Opsi crop-only empat class

Jika ingin eksperimen model canonical yang belajar `person/head/car/motorcycle`
dalam satu weight, raw export dapat dilatih langsung:

```bash
DATASET_TRAINING_ENABLED=true python scripts/train_detector.py \
  data/datasets/vehicle-person-detector/v359 \
  --base-model models/yolo26n.pt \
  --version detector-v359-four-class-v1 \
  --class-names person head car motorcycle \
  --epochs 60 \
  --imgsz 640 \
  --batch 8 \
  --patience 12 \
  --workers 0 \
  --seed 42 \
  --device mps
```

Ini bukan profile untuk `CUSTOM_DETECTOR_MODEL_PATH` hybrid. Runtime hybrid
mengharapkan tiga class custom. Pada runtime non-hybrid saat ini, head juga tidak
dipakai oleh tracker utama. Gunakan eksperimen empat class hanya bila tujuannya
jelas dan evaluasinya dipisahkan.

---

## 15. Menyiapkan batch full-frame baru

Untuk full-frame v2, buat workspace baru:

```text
data/full-frame-assets/all-frame-conditions-labeled-v2/
├── labels/
├── manifest.json
├── annotation-report.json
└── README.md
```

Jangan menaruh label baru ke workspace v1.

### 15.1 Struktur label

Untuk setiap image:

```text
images/frame-001.jpg
labels/frame-001.txt
```

Format baris YOLO:

```text
class_id x_center y_center width height
```

Mapping canonical:

```text
0 person
1 head
2 car
3 motorcycle
```

Negative frame memiliki file label kosong.

### 15.2 Isi manifest

Setiap item minimal memiliki:

```json
{
  "image": "../source/frame-001.jpg",
  "label": "labels/frame-001.txt",
  "lens": "lens-1",
  "lighting": "day",
  "scene": "person",
  "usage": "train",
  "group": "event-001"
}
```

Nilai scene yang didukung:

```text
empty
person
motorcycle
mixed
```

Gunakan event group sama untuk frame berurutan dari kejadian sama.

### 15.3 Cakupan full-frame

Masukkan variasi:

- kedua lens;
- siang dan malam;
- hujan/jalan basah;
- person dekat, jauh, anak, dan occlusion;
- motorcycle diam dan bergerak;
- motorcycle dengan/tanpa pengendara;
- frame kosong;
- car-only;
- pagar, tanaman, hewan, bayangan, dan gerobak;
- contoh false positive dari model sebelumnya.

---

## 16. Membangun dataset full-frame canonical

```bash
python scripts/prepare_full_frame_dataset.py \
  data/full-frame-assets/all-frame-conditions-labeled-v2/manifest.json \
  data/datasets/full-frame-conditions-v2
```

Periksa:

```bash
cat data/datasets/full-frame-conditions-v2/metadata.json
cat data/datasets/full-frame-conditions-v2/data.yaml
```

Jangan memakai output name yang sudah ada.

---

## 17. Membuat subset full-frame custom

```bash
python scripts/prepare_training_subset.py \
  data/datasets/full-frame-conditions-v2 \
  data/datasets/full-frame-conditions-v2-person-head-motorcycle \
  --classes person head motorcycle \
  --keep-empty
```

`--keep-empty` wajib dipertahankan untuk full-frame agar background/car-only
menjadi negative sample custom.

Periksa bahwa `negativeImageCount` lebih dari nol bila batch memang memiliki
background atau car-only frame.

---

## 18. Jalur B — training full-frame-only

Full-only berguna sebagai eksperimen domain, tetapi bukan pilihan utama bila
ingin mempertahankan kualitas crop lama.

### 18.1 Smoke full-only

```bash
DATASET_TRAINING_ENABLED=true python scripts/train_detector.py \
  data/datasets/full-frame-conditions-v2-person-head-motorcycle \
  --base-model models/yolo26n.pt \
  --version detector-full-frame-v2-phm-smoke-v1 \
  --class-names person head motorcycle \
  --epochs 8 \
  --imgsz 416 \
  --batch 8 \
  --patience 4 \
  --workers 0 \
  --seed 42 \
  --device mps
```

### 18.2 Main full-only

```bash
DATASET_TRAINING_ENABLED=true python scripts/train_detector.py \
  data/datasets/full-frame-conditions-v2-person-head-motorcycle \
  --base-model models/yolo26n.pt \
  --version detector-full-frame-v2-phm-v1 \
  --class-names person head motorcycle \
  --epochs 80 \
  --imgsz 640 \
  --batch 8 \
  --patience 15 \
  --workers 0 \
  --seed 42 \
  --device mps
```

### 18.3 Evaluasi full-only

```bash
python scripts/evaluate_detector.py \
  --model data/training-runs/detector-full-frame-v2-phm-v1/weights/best.pt \
  --data data/datasets/full-frame-conditions-v2-person-head-motorcycle/data.yaml \
  --device mps
```

Bandingkan juga model full-only pada validation crop untuk melihat apakah
kemampuan crop lama menurun.

---

## 19. Jalur C — menggabungkan crop + full-frame

Gunakan satu crop export terbaru dan satu atau lebih batch full-frame yang tidak
duplikat.

Contoh bila v359 dan full-frame v2 adalah dataset terbaru:

```bash
python scripts/merge_training_datasets.py \
  data/datasets/v359-plus-full-frame-phm-v2 \
  --source data/datasets/vehicle-person-detector/v359-person-head-motorcycle \
  --source data/datasets/full-frame-conditions-v1-person-head-motorcycle \
  --source data/datasets/full-frame-conditions-v2-person-head-motorcycle
```

Alternatif: bila `full-frame-conditions-v2` sudah cumulative dan berisi seluruh
v1, jangan masukkan source v1 lagi:

```bash
python scripts/merge_training_datasets.py \
  data/datasets/v359-plus-full-frame-phm-v2 \
  --source data/datasets/vehicle-person-detector/v359-person-head-motorcycle \
  --source data/datasets/full-frame-conditions-v2-person-head-motorcycle
```

Tool merge akan:

- memeriksa mapping;
- mempertahankan split;
- memberi prefix filename;
- mempertahankan empty label;
- menolak exact duplicate;
- mencatat provenance.

Jangan mengubah gambar sedikit hanya untuk melewati duplicate check.

---

## 20. Validasi dataset gabungan

```bash
cat data/datasets/v359-plus-full-frame-phm-v2/metadata.json
cat data/datasets/v359-plus-full-frame-phm-v2/data.yaml
```

Hitung file:

```bash
find data/datasets/v359-plus-full-frame-phm-v2/images/train -type f | wc -l
find data/datasets/v359-plus-full-frame-phm-v2/labels/train -type f | wc -l
find data/datasets/v359-plus-full-frame-phm-v2/images/val -type f | wc -l
find data/datasets/v359-plus-full-frame-phm-v2/labels/val -type f | wc -l
```

Jumlah image dan label pada masing-masing split harus sama.

Jalankan validator:

```bash
python -c 'from pathlib import Path; from scripts.train_detector import validate_dataset; print(validate_dataset(Path("data/datasets/v359-plus-full-frame-phm-v2").resolve(), {0: "person", 1: "head", 2: "motorcycle"}))'
```

---

## 21. Jalur C — smoke crop + full-frame

```bash
DATASET_TRAINING_ENABLED=true python scripts/train_detector.py \
  data/datasets/v359-plus-full-frame-phm-v2 \
  --base-model models/yolo26n.pt \
  --version detector-v359-full-frame-phm-smoke-v1 \
  --class-names person head motorcycle \
  --epochs 8 \
  --imgsz 416 \
  --batch 8 \
  --patience 4 \
  --workers 0 \
  --seed 42 \
  --device mps
```

Smoke hanya mengecek pipeline. Jangan deploy smoke model.

---

## 22. Jalur C — main crop + full-frame

```bash
DATASET_TRAINING_ENABLED=true python scripts/train_detector.py \
  data/datasets/v359-plus-full-frame-phm-v2 \
  --base-model models/yolo26n.pt \
  --version detector-v359-full-frame-phm-hybrid-v1 \
  --class-names person head motorcycle \
  --epochs 80 \
  --imgsz 640 \
  --batch 8 \
  --patience 15 \
  --workers 0 \
  --seed 42 \
  --device mps
```

Mulai crop-only dan merged dari YOLO base yang sama bila ingin membandingkan
pengaruh dataset secara adil.

Output yang wajib tersedia sebelum kandidat dianggap selesai:

```text
weights/best.pt
weights/last.pt
results.csv
args.yaml
training-metadata.json
```

Jika `training-metadata.json` tidak ada, anggap run belum selesai/gagal.

---

## 23. Evaluasi crop + full-frame

```bash
python scripts/evaluate_detector.py \
  --model data/training-runs/detector-v359-full-frame-phm-hybrid-v1/weights/best.pt \
  --data data/datasets/v359-plus-full-frame-phm-v2/data.yaml \
  --device mps
```

Laporan default:

```text
weights/best.evaluation.json
```

Periksa:

- overall precision;
- overall recall;
- mAP50;
- mAP50-95;
- person precision/recall;
- head precision/recall;
- motorcycle precision/recall.

Evaluasi crop-only, full-only, dan merged pada validation yang sama untuk
perbandingan tambahan. Rename/copy evaluation report setelah setiap evaluasi
karena output default dapat tertimpa.

---

## 24. Optional continued fine-tuning

Default yang paling reproducible adalah mulai dari `models/yolo26n.pt`.

Jika ingin melanjutkan model custom lama, mapping model lama dan dataset baru
harus sama:

```bash
DATASET_TRAINING_ENABLED=true python scripts/train_detector.py \
  data/datasets/v359-plus-full-frame-phm-v2 \
  --base-model data/training-runs/detector-v358-full-frame-phm-hybrid-v2/weights/best.pt \
  --version detector-v359-full-frame-phm-finetune-v1 \
  --class-names person head motorcycle \
  --epochs 30 \
  --imgsz 640 \
  --batch 8 \
  --patience 8 \
  --workers 0 \
  --seed 42 \
  --device mps
```

Jangan fine-tune hanya pada beberapa image baru. Dataset baru tetap harus
memuat data lama yang ingin dipertahankan untuk mengurangi catastrophic
forgetting.

Anggap warm-start sebagai eksperimen berbeda, bukan kelanjutan otomatis.

---

## 25. Jalur D — crop + full + YOLO hybrid

Tidak ada training tambahan khusus untuk menggabungkan YOLO. Setelah custom
model crop + full selesai, runtime menjalankan dua model:

```text
custom best.pt -> person, head, motorcycle
yolo26n.pt     -> car
```

Konfigurasi `cv/.env`:

```dotenv
MODEL_PATH=yolo26n.pt
EXPERIMENTAL_HYBRID_DETECTOR_ENABLED=true
CUSTOM_DETECTOR_MODEL_PATH=data/training-runs/detector-v359-full-frame-phm-hybrid-v1/weights/best.pt
DEVICE=mps
CONFIDENCE_THRESHOLD=0.25
IOU_THRESHOLD=0.50
IMAGE_SIZE=640
```

Validasi tanpa startup:

```bash
python -c 'from src.config import Settings; s=Settings(); print({"hybrid": s.EXPERIMENTAL_HYBRID_DETECTOR_ENABLED, "custom": str(s.custom_detector_model_path), "legacy_car": str(s.model_path), "confidence": s.CONFIDENCE_THRESHOLD, "iou": s.IOU_THRESHOLD, "image_size": s.IMAGE_SIZE})'
```

Pastikan:

- hybrid `True`;
- custom menunjuk `best.pt`;
- legacy menunjuk `models/yolo26n.pt`;
- mapping custom tiga class benar.

---

## 26. Membuat regression set independen

Kumpulkan 40–80 frame baru yang tidak pernah masuk training:

- 10–20 kosong;
- 10–20 person;
- 10–20 motorcycle;
- kedua lens;
- siang dan malam;
- kondisi sulit/hard-negative.

Tandai item manifest dengan:

```json
"usage": "regression"
```

Buat dataset regression canonical, misalnya:

```bash
python scripts/prepare_full_frame_dataset.py \
  data/full-frame-assets/regression-v1/manifest.json \
  data/datasets/full-frame-regression-v1 \
  --enforce-regression-baseline
```

Jangan membuat subset training dari regression set.

---

## 27. Evaluasi legacy vs hybrid

```bash
python scripts/evaluate_hybrid_regression.py \
  data/datasets/full-frame-regression-v1 \
  --legacy-model models/yolo26n.pt \
  --custom-model data/training-runs/detector-v359-full-frame-phm-hybrid-v1/weights/best.pt \
  --confidence 0.25 \
  --iou 0.50 \
  --match-iou 0.50 \
  --imgsz 640 \
  --device mps
```

Periksa:

- person recall;
- motorcycle recall;
- false positive pada empty frame;
- head masuk akal;
- car dari legacy tetap stabil;
- jumlah frame dengan false positive.

Threshold regression dan runtime harus sama. Jika threshold diubah, regression
harus diulang.

---

## 28. Visual review

```bash
yolo predict \
  model=data/training-runs/detector-v359-full-frame-phm-hybrid-v1/weights/best.pt \
  source=data/datasets/full-frame-regression-v1/images/regression \
  conf=0.25 \
  iou=0.50 \
  imgsz=640 \
  device=mps \
  project=data/prediction-reviews \
  name=detector-v359-full-frame-phm-hybrid-v1
```

Cari masalah berikut:

- background dianggap person;
- gerobak dianggap motorcycle;
- car dianggap motorcycle/person;
- person jauh hilang;
- motorcycle diam tidak ditemukan;
- head terlalu besar atau berada pada background;
- false positive malam/hujan.

---

## 29. Acceptance gate

| Pemeriksaan | Gate awal |
| --- | --- |
| Mapping custom | Persis person=0, head=1, motorcycle=2 |
| Dataset validation | Lulus tanpa leakage/error |
| Training artifact | `best.pt` dan `training-metadata.json` tersedia |
| Person recall | Tidak turun lebih dari 0.02 dari baseline disetujui |
| Motorcycle recall | Tidak turun; idealnya meningkat |
| Empty false positive | Tidak lebih buruk dari baseline |
| Head | Box berada pada kepala |
| Car | Tetap stabil dari legacy YOLO |
| Live performance | FPS/latency/queue aman |

Jangan approve hanya karena mAP50 meningkat.

---

## 30. Canary live kedua lens

Jalankan:

```bash
python -m src.main
```

Startup hybrid yang benar:

```text
Model           : custom=best.pt (person, head, motorcycle); legacy=yolo26n.pt (car)
Object Classes  : person, head, motorcycle, car
```

Checklist:

1. Background kosong beberapa menit.
2. Person dekat/jauh.
3. Person IN/OUT.
4. Anak dan occlusion.
5. Motorcycle diam/bergerak.
6. Motorcycle dengan/tanpa pengendara.
7. Car tetap terdeteksi.
8. Gerobak/pagar/tanaman/hewan tidak menjadi objek palsu.
9. Head masuk akal.
10. FPS, latency, suhu, dan queue aman.

Mode hybrid melakukan dua inference pass sehingga lebih berat daripada satu
model.

---

## 31. Person capture recording toggle saat canary

Pada Live Monitoring, gunakan toggle **Person capture recording**:

- OFF: preview, inference, tracking, bounding box, line-crossing counting,
  event, IN/OUT, dan statistik tetap aktif, tetapi image full-body/head baru
  tidak disimpan;
- ON: penyimpanan image full-body/head aktif kembali, sedangkan counting memang
  terus berjalan pada kedua kondisi.

Gunakan OFF untuk observasi awal model tanpa menambah image person capture.
Counting event tetap menjadi data operasional dan tetap disimpan. Setelah hasil
crop stabil, aktifkan ON untuk menguji alur person-capture persistence.

Toggle ini bukan pengganti regression. Bounding box tetap berasal dari model
yang sedang diuji.

---

## 32. Registrasi, approval, dan aktivasi model

Setelah evaluasi lengkap, kandidat dapat diregistrasikan melalui:

```text
POST /api/models/versions
```

Catat:

- dataset version;
- model path;
- training parameters;
- precision;
- recall;
- mAP50;
- mAP50-95;
- per-class metrics.

Alur registry:

```text
candidate -> approved -> active
candidate -> rejected
active -> retired saat kandidat lain diaktifkan
```

Aktivasi registry tidak otomatis mengubah `.env` atau restart CV. Deployment
tetap memerlukan perubahan `CUSTOM_DETECTOR_MODEL_PATH` dan restart eksplisit.

---

## 33. Rollback

Jika hybrid bermasalah:

```dotenv
EXPERIMENTAL_HYBRID_DETECTOR_ENABLED=false
MODEL_PATH=yolo26n.pt
```

Restart CV:

```bash
python -m src.main
```

Atau kembalikan `CUSTOM_DETECTOR_MODEL_PATH` ke custom model sebelumnya yang
sudah disetujui.

Jangan hapus kandidat gagal. Simpan untuk audit dan perbandingan.

---

## 34. Siklus ketika ada data baru

### 34.1 Hanya crop baru

```text
export v360
-> buat v360-person-head-motorcycle
-> validate
-> smoke
-> main
-> evaluate
```

Jangan merge v359 + v360 bila v360 sudah kumulatif.

### 34.2 Hanya full-frame baru

```text
label full-frame v3
-> build canonical v3
-> build subset v3
-> merge dengan crop terbaru
-> validate
-> smoke/main/evaluate
```

### 34.3 Crop dan full-frame baru

```text
crop terbaru saja
+ seluruh batch full-frame non-duplikat
-> merge version baru
-> train version baru
```

### 34.4 Model lama gagal pada kondisi tertentu

1. Simpan frame gagal.
2. Label semua objek target pada frame.
3. Tambahkan background serupa bila false positive.
4. Buat dataset version baru.
5. Jangan mengubah regression lama.
6. Train kandidat baru.
7. Evaluasi pada regression lama.
8. Canary dan rollback bila perlu.

---

## 35. Matriks perbandingan eksperimen

Catat setiap eksperimen dalam tabel seperti ini:

| Model | Dataset | Base | Epoch | Img size | Precision | Recall | mAP50 | FP kosong | Live |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Crop-only | v359 PHM | yolo26n | 60 | 640 |  |  |  |  |  |
| Full-only | full v2 PHM | yolo26n | 80 | 640 |  |  |  |  |  |
| Crop+full | merged v2 | yolo26n | 80 | 640 |  |  |  |  |  |
| Fine-tune | merged v2 | previous best | 30 | 640 |  |  |  |  |  |

Jangan membandingkan model menggunakan dataset validation berbeda tanpa
menyebutkan perbedaannya.

---

## 36. Troubleshooting

### Output dataset sudah ada

Gunakan version name baru. Script sengaja menolak overwrite.

### Mapping mismatch saat merge

Pastikan semua source adalah subset custom `person/head/motorcycle`, bukan raw
canonical.

### Duplicate image

Hapus duplicate dari salah satu source secara terkontrol atau gunakan source
cumulative saja. Jangan edit pixel agar hash berubah.

### Training disabled

Prefix wajib:

```text
DATASET_TRAINING_ENABLED=true
```

### MPS out of memory

- hentikan realtime CV;
- gunakan `--workers 0`;
- turunkan batch 8 menjadi 4;
- gunakan model version baru.

### Ada `best.pt` tetapi metadata tidak ada

Anggap training belum lengkap. Periksa proses dan `results.csv`; jangan deploy.

### Head tidak muncul di runtime hybrid

Periksa mapping custom dan pastikan `CUSTOM_DETECTOR_MODEL_PATH` menunjuk model
tiga class.

### Car hilang

Periksa:

```dotenv
MODEL_PATH=yolo26n.pt
EXPERIMENTAL_HYBRID_DETECTOR_ENABLED=true
```

Car berasal dari YOLO legacy.

### Regression evaluator tidak menemukan image

Dataset belum memiliki `images/regression`. Buat regression set independen.

### False positive meningkat setelah menambah full-frame

Review label yang tidak lengkap, tambahkan empty/hard-negative, dan periksa
apakah objek target yang terlihat dibiarkan tanpa label.

---

## 37. Checklist sebelum training

- [ ] Dataset source version baru dan immutable.
- [ ] Semua annotation sudah direview.
- [ ] Mapping canonical benar.
- [ ] Subset custom mapping 0/1/2 benar.
- [ ] Negative image dipertahankan.
- [ ] Group event tidak bocor antar split.
- [ ] Exact duplicate check lulus.
- [ ] Realtime CV sudah berhenti.
- [ ] Smoke version name belum pernah dipakai.
- [ ] Main version name belum pernah dipakai.
- [ ] Base model benar.
- [ ] Seed, image size, batch, dan device dicatat.

---

## 38. Checklist sebelum deployment hybrid

- [ ] `best.pt` tersedia.
- [ ] `training-metadata.json` tersedia.
- [ ] Evaluation JSON tersedia.
- [ ] Per-class metrics sudah dibandingkan.
- [ ] Regression independen lulus.
- [ ] Visual review lulus.
- [ ] Mapping custom benar.
- [ ] YOLO legacy tersedia.
- [ ] `.env` menunjuk path model benar.
- [ ] Canary kedua lens lulus.
- [ ] Person capture recording awal dapat dibuat OFF tanpa menghentikan counting.
- [ ] Rollback sudah disiapkan.

---

## 39. Rekomendasi default untuk training berikutnya

Untuk iterasi normal:

1. Export crop terbaru yang sudah approved.
2. Buat subset custom dengan `--keep-empty`.
3. Siapkan batch full-frame baru sebagai versi baru.
4. Pertahankan full-frame lama bila masih relevan dan tidak duplikat.
5. Merge satu crop terbaru + full-frame lama/baru.
6. Validate dataset tanpa training.
7. Jalankan smoke.
8. Jalankan main dari `models/yolo26n.pt`.
9. Evaluasi pada merged validation dan regression independen.
10. Review visual.
11. Pasang custom model bersama YOLO legacy.
12. Canary dengan recording OFF terlebih dahulu.
13. Aktifkan recording setelah hasil stabil.
14. Approve/activate registry dan simpan rollback path.

Alur ini dapat diulang untuk v359, v360, full-frame v2/v3, atau versi setelahnya
tanpa mengubah dataset/model lama.

---

## 40. Step-by-step menambahkan image full-frame baru

Bagian ini menjawab secara khusus: jika nanti ada gambar full-frame baru, file
harus ditaruh di mana dan bagaimana menjadikannya siap training.

### 40.1 Jangan taruh raw image di `data/datasets`

Folder berikut adalah output hasil build dan tidak boleh menjadi tempat raw
image:

```text
data/datasets/
```

Raw full-frame dan label kerja disimpan di:

```text
data/full-frame-assets/
```

### 40.2 Buat workspace version baru

Contoh batch berikutnya adalah full-frame v2:

```bash
cd /Users/ugiispoyowidodo/Data/pribadi/cv/cctv-detection/cv

mkdir -p data/full-frame-assets/full-frame-conditions-v2/images
mkdir -p data/full-frame-assets/full-frame-conditions-v2/labels
```

Struktur akhirnya:

```text
data/full-frame-assets/full-frame-conditions-v2/
├── images/
│   ├── lens-1-day-event-001-001.jpg
│   ├── lens-1-day-event-001-002.jpg
│   ├── lens-2-night-event-002-001.jpg
│   └── ...
├── labels/
│   ├── lens-1-day-event-001-001.txt
│   ├── lens-1-day-event-001-002.txt
│   ├── lens-2-night-event-002-001.txt
│   └── ...
├── manifest.json
├── annotation-report.json
└── README.md
```

Untuk batch sesudahnya, buat folder baru:

```text
data/full-frame-assets/full-frame-conditions-v3/
data/full-frame-assets/full-frame-conditions-v4/
```

Jangan menambahkan gambar v2 ke workspace v1 setelah v1 pernah dipakai
training.

### 40.3 Salin image native ke folder `images`

Tempat tujuan persis:

```text
cv/data/full-frame-assets/full-frame-conditions-v2/images/
```

Contoh:

```bash
cp /path/dari/camera/frame-001.jpg \
  data/full-frame-assets/full-frame-conditions-v2/images/lens-1-day-event-001-001.jpg
```

Gunakan full-frame asli dari RTSP/camera bila tersedia. Hindari screenshot
Dashboard, crop person, gambar WhatsApp, atau gambar yang sudah berkali-kali
resize. Pertahankan resolusi dan aspect ratio asli.

Gunakan ekstensi `.jpg` untuk kompatibilitas penuh dengan validator training
saat ini. Jika source PNG, konversi sebagai file baru di workspace:

```bash
sips -s format jpeg /path/dari/camera/frame-001.png \
  --out data/full-frame-assets/full-frame-conditions-v2/images/lens-1-day-event-001-001.jpg
```

Jangan menghapus source asli dari lokasi asal.

### 40.4 Gunakan nama file yang informatif

Pola yang disarankan:

```text
<lens>-<lighting>-<event>-<sequence>.jpg
```

Contoh:

```text
lens-1-day-event-001-001.jpg
lens-1-day-event-001-002.jpg
lens-2-night-event-002-001.jpg
lens-2-night-event-002-002.jpg
```

Nama event membantu memastikan frame berurutan tidak terpisah antara train dan
validation.

### 40.5 Buang exact duplicate sebelum labeling

Periksa hash:

```bash
shasum -a 256 data/full-frame-assets/full-frame-conditions-v2/images/*.jpg \
  | sort
```

Jika dua file memiliki hash sama, pertahankan satu saja. Frame yang sangat mirip
tetapi bukan exact duplicate tetap perlu dikurangi agar dataset tidak didominasi
satu kejadian.

### 40.6 Label setiap image

Setiap image wajib memiliki file `.txt` dengan stem sama:

```text
images/lens-1-day-event-001-001.jpg
labels/lens-1-day-event-001-001.txt
```

Gunakan mapping canonical:

```text
0 person
1 head
2 car
3 motorcycle
```

Format YOLO normalized:

```text
class_id x_center y_center width height
```

Contoh isi label:

```text
0 0.510000 0.520000 0.180000 0.620000
1 0.515000 0.245000 0.060000 0.090000
3 0.600000 0.700000 0.310000 0.260000
2 0.210000 0.610000 0.300000 0.230000
```

Aturan label:

- person mengelilingi tubuh yang terlihat;
- head hanya kepala;
- car hanya mobil;
- motorcycle hanya motor, bukan seluruh pengendara;
- label semua target yang jelas dalam frame;
- jangan membiarkan target jelas tanpa label;
- jangan label gerobak atau sepeda sebagai motorcycle;
- objek terlalu ambigu sebaiknya masuk review, bukan langsung training.

### 40.7 Buat label kosong untuk negative frame

Jika frame benar-benar tidak memiliki person, head, car, atau motorcycle, buat
file kosong:

```bash
touch data/full-frame-assets/full-frame-conditions-v2/labels/lens-1-day-event-003-001.txt
```

File kosong adalah negative sample yang valid. File label yang hilang bukan
negative sample dan akan ditolak pipeline.

Jika frame hanya berisi car, label car tetap ditulis pada canonical label.
Setelah subset custom dibuat, frame tersebut otomatis menjadi negative untuk
person/head/motorcycle.

### 40.8 Pastikan semua image mempunyai label

Jalankan pemeriksaan sederhana:

```bash
python -c 'from pathlib import Path; root=Path("data/full-frame-assets/full-frame-conditions-v2"); images={p.stem for p in (root/"images").glob("*.jpg")}; labels={p.stem for p in (root/"labels").glob("*.txt")}; print({"images":len(images),"labels":len(labels),"missing_labels":sorted(images-labels),"orphan_labels":sorted(labels-images)})'
```

`missing_labels` dan `orphan_labels` harus kosong.

### 40.9 Buat manifest

Buat file:

```text
data/full-frame-assets/full-frame-conditions-v2/manifest.json
```

Contoh lengkap:

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
      "image": "images/lens-1-day-event-001-001.jpg",
      "label": "labels/lens-1-day-event-001-001.txt",
      "lens": "lens-1",
      "lighting": "day",
      "scene": "mixed",
      "usage": "train",
      "group": "lens-1-day-event-001"
    },
    {
      "image": "images/lens-1-day-event-003-001.jpg",
      "label": "labels/lens-1-day-event-003-001.txt",
      "lens": "lens-1",
      "lighting": "day",
      "scene": "empty",
      "usage": "train",
      "group": "lens-1-day-event-003"
    },
    {
      "image": "images/lens-2-night-event-002-001.jpg",
      "label": "labels/lens-2-night-event-002-001.txt",
      "lens": "lens-2",
      "lighting": "night",
      "scene": "motorcycle",
      "usage": "train",
      "group": "lens-2-night-event-002"
    }
  ]
}
```

Nilai valid:

```text
lens:     lens-1 | lens-2
lighting: day | night
scene:    empty | person | motorcycle | mixed
usage:    train | regression
```

Catatan:

- `scene=empty` hanya boleh digunakan bila label benar-benar kosong;
- car-only frame dapat memakai `scene=mixed` karena canonical label tidak
  kosong;
- semua frame dari event sama harus memakai `group` sama;
- bila `usage=regression`, seluruh group tersebut harus regression.

### 40.10 Buat annotation report dan README

Simpan ringkasan minimal di `annotation-report.json`:

```json
{
  "versionId": "full-frame-conditions-v2",
  "imageCount": 120,
  "reviewStatus": "manually reviewed",
  "notes": [
    "Both lenses included",
    "Day and night included",
    "Empty labels are intentional negatives"
  ]
}
```

README sebaiknya menjelaskan tanggal pengambilan, lens, kondisi, sumber image,
class mapping, reviewer, dan batasan dataset.

### 40.11 Build dataset canonical

Setelah image, label, dan manifest selesai:

```bash
python scripts/prepare_full_frame_dataset.py \
  data/full-frame-assets/full-frame-conditions-v2/manifest.json \
  data/datasets/full-frame-conditions-v2
```

Output dibangun di:

```text
data/datasets/full-frame-conditions-v2/
```

Folder output tersebut tidak boleh diedit manual.

Periksa metadata:

```bash
cat data/datasets/full-frame-conditions-v2/metadata.json
cat data/datasets/full-frame-conditions-v2/data.yaml
```

### 40.12 Buat subset full-frame custom

```bash
python scripts/prepare_training_subset.py \
  data/datasets/full-frame-conditions-v2 \
  data/datasets/full-frame-conditions-v2-person-head-motorcycle \
  --classes person head motorcycle \
  --keep-empty
```

Output siap training:

```text
data/datasets/full-frame-conditions-v2-person-head-motorcycle/
```

Mapping output wajib:

```text
0 person
1 head
2 motorcycle
```

### 40.13 Validasi subset full-frame

```bash
python -c 'from pathlib import Path; from scripts.train_detector import validate_dataset; print(validate_dataset(Path("data/datasets/full-frame-conditions-v2-person-head-motorcycle").resolve(), {0:"person",1:"head",2:"motorcycle"}))'
```

Jangan lanjut bila validator gagal.

### 40.14 Pilihan 1 — training full-frame saja

Smoke:

```bash
DATASET_TRAINING_ENABLED=true python scripts/train_detector.py \
  data/datasets/full-frame-conditions-v2-person-head-motorcycle \
  --base-model models/yolo26n.pt \
  --version detector-full-frame-v2-phm-smoke-v1 \
  --class-names person head motorcycle \
  --epochs 8 --imgsz 416 --batch 8 --patience 4 \
  --workers 0 --seed 42 --device mps
```

Main:

```bash
DATASET_TRAINING_ENABLED=true python scripts/train_detector.py \
  data/datasets/full-frame-conditions-v2-person-head-motorcycle \
  --base-model models/yolo26n.pt \
  --version detector-full-frame-v2-phm-v1 \
  --class-names person head motorcycle \
  --epochs 80 --imgsz 640 --batch 8 --patience 15 \
  --workers 0 --seed 42 --device mps
```

### 40.15 Pilihan 2 — gabungkan dengan crop terbaru

Misalnya crop terbaru adalah v359:

```bash
python scripts/merge_training_datasets.py \
  data/datasets/v359-plus-full-frame-phm-v2 \
  --source data/datasets/vehicle-person-detector/v359-person-head-motorcycle \
  --source data/datasets/full-frame-conditions-v1-person-head-motorcycle \
  --source data/datasets/full-frame-conditions-v2-person-head-motorcycle
```

Jika full-frame v2 sudah cumulative dan memuat v1, hapus source v1 dari
perintah agar tidak duplikat.

Setelah merge, lakukan validate, smoke, main training, evaluation, regression,
dan canary seperti bagian sebelumnya.

### 40.16 Ketika ada full-frame berikutnya

Untuk batch berikutnya, ulangi dari langkah 40.2 dengan version baru:

```text
full-frame-conditions-v3
```

Jangan menimpa:

```text
full-frame-conditions-v1
full-frame-conditions-v2
```

Gunakan salah satu strategi:

- incremental sources: merge full v1 + v2 + v3;
- cumulative latest: full v3 sudah memuat v1 + v2 + image baru.

Jangan memakai kedua strategi sekaligus karena akan membuat duplicate.

### 40.17 Ringkasan lokasi folder

| Tahap | Lokasi |
| --- | --- |
| Raw full-frame baru | `data/full-frame-assets/full-frame-conditions-v2/images/` |
| Label kerja | `data/full-frame-assets/full-frame-conditions-v2/labels/` |
| Manifest | `data/full-frame-assets/full-frame-conditions-v2/manifest.json` |
| Dataset canonical hasil build | `data/datasets/full-frame-conditions-v2/` |
| Subset custom hasil build | `data/datasets/full-frame-conditions-v2-person-head-motorcycle/` |
| Dataset gabungan | `data/datasets/v359-plus-full-frame-phm-v2/` |
| Hasil training | `data/training-runs/<model-version>/` |

Yang diedit manual hanya workspace di `data/full-frame-assets`. Folder
`data/datasets` dan `data/training-runs` adalah output versioned dari pipeline.
