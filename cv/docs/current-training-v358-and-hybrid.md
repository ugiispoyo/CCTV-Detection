# Panduan training model crop, full-frame, dan runtime hybrid

Dokumen ini adalah panduan operasional berdasarkan isi repository pada
2026-11-14. Dokumen ini hanya berisi langkah dan perintah untuk dijalankan nanti.
Pembuatan dokumen ini tidak menjalankan training.

Tujuan akhirnya adalah arsitektur berikut:

```text
Full-frame RTSP
├── custom best.pt -> person, head, motorcycle
└── yolo26n.pt     -> car
```

Ada dua arti penggunaan YOLO yang perlu dibedakan:

1. `models/yolo26n.pt` menjadi pretrained starting weight saat training custom.
2. Pada runtime hybrid, `yolo26n.pt` tetap berjalan sebagai detector `car`,
   berdampingan dengan custom model.

Tidak ada penggabungan dua file `.pt`, averaging weight, atau voting box. Runtime
memanggil dua detector pada frame yang sama dan mengambil class berbeda dari
masing-masing detector. Cara ini mencegah box `car` ganda.

## 1. Pilih alur yang dibutuhkan

| Alur | Dataset | Kegunaan |
| --- | --- | --- |
| A. Crop-only | Export seperti v357/v358 | Baseline cepat dan pembanding historis |
| B. Crop + full-frame | Subset crop + 137 full-frame | Kandidat utama untuk kondisi CCTV nyata |
| C. Runtime hybrid | Custom model + `yolo26n.pt` | Custom untuk person/head/motorcycle, YOLO untuk car |

Urutan yang disarankan:

```text
export crop terbaru
-> buat/periksa subset person-head-motorcycle
-> smoke crop-only
-> main crop-only
-> evaluasi crop-only
-> merge subset crop dengan subset full-frame
-> smoke merged
-> main merged
-> evaluasi merged
-> bandingkan kedua kandidat
-> regression independen
-> canary hybrid dua lens
-> aktivasi atau rollback
```

Jangan langsung mengganti model live hanya karena training selesai atau mAP
crop tinggi.

## 2. Kondisi repository saat dokumen dibuat

Export crop terbaru yang tersedia:

| Dataset | Image | Annotation | Tracking session |
| --- | ---: | ---: | ---: |
| v357 | 314 | 677 | 41 |
| v358 | 315 | 681 | 41 |

Mapping canonical export crop:

```text
0 person
1 head
2 car
3 motorcycle
```

Subset berikut sudah tersedia:

```text
data/datasets/vehicle-person-detector/v358-person-head-motorcycle/
```

Mapping subset custom tersebut:

```text
0 person
1 head
2 motorcycle
```

Subset v358 memiliki 315 image dan 681 annotation, dengan 198 image train dan
117 image validation.

Full-frame yang sudah disiapkan:

```text
data/datasets/full-frame-conditions-v1/
data/datasets/full-frame-conditions-v1-person-head-motorcycle/
```

Subset full-frame memiliki:

- 137 image;
- 292 annotation custom;
- 54 negative image setelah class `car` dikeluarkan;
- 111 image train dan 26 image validation;
- 144 person, 48 head, dan 100 motorcycle box.

Dataset merge yang sudah ada masih berbasis v298:

```text
data/datasets/v298-plus-full-frame-phm-v1/
```

Jangan menyebut dataset tersebut sebagai merge v358. Untuk memakai v358, buat
output baru `v358-plus-full-frame-phm-v1` dengan langkah pada dokumen ini.

Training run yang sudah terlihat untuk v358:

```text
data/training-runs/detector-v358-phm-smoke-v1/
data/training-runs/detector-v358-phm-live-v1/
```

Smoke v1 memiliki `training-metadata.json` dan selesai 10 epoch. Folder live v1
memiliki beberapa artifact dan weight, tetapi belum memiliki
`training-metadata.json` pada saat audit dokumen ini. Jangan menganggap live v1
sebagai kandidat lengkap sebelum prosesnya dipastikan selesai dan dievaluasi.
Gunakan nama versi baru seperti `live-v2` untuk percobaan berikutnya; jangan
menimpa folder yang sudah ada.

## 3. Aturan class yang wajib dipahami

Runtime hybrid mengharapkan custom model persis:

```text
0 person
1 head
2 motorcycle
```

Karena itu raw export `v358` tidak boleh langsung dipasang sebagai
`CUSTOM_DETECTOR_MODEL_PATH`. Pada raw export, class `2` adalah `car`, bukan
`motorcycle`. Runtime akan menolak model dengan mapping yang salah.

Model legacy `yolo26n.pt` memakai class COCO yang dibutuhkan runtime:

```text
0 person
2 car
3 motorcycle
```

Dalam mode hybrid, runtime hanya mengambil `car` dari model legacy.

## 4. Persiapan terminal

Masuk ke folder CV:

```bash
cd /Users/ugiispoyowidodo/Data/pribadi/cv/cctv-detection/cv
source .venv/bin/activate
```

Periksa Python, Ultralytics, dan Apple MPS:

```bash
python --version
python -c "import ultralytics; print('Ultralytics:', ultralytics.__version__)"
python -c "import torch; print('MPS available:', torch.backends.mps.is_available())"
```

Pada Apple Silicon, `MPS available` idealnya `True`. Jika `False`, gunakan
`--device cpu`, tetapi training akan jauh lebih lambat.

Periksa base model dan dataset saat ini:

```bash
test -f models/yolo26n.pt && echo "base model OK"
test -f data/datasets/vehicle-person-detector/v358/metadata.json && echo "v358 OK"
test -f data/datasets/vehicle-person-detector/v358-person-head-motorcycle/data.yaml && echo "v358 subset OK"
test -f data/datasets/full-frame-conditions-v1-person-head-motorcycle/data.yaml && echo "full-frame subset OK"
```

Jangan menjalankan realtime CV dan training MPS bersamaan.

## 5. Memilih export crop

Gunakan versi export tertinggi yang sudah selesai direview. Contoh saat ini
adalah v358. Jangan otomatis memilih angka tertinggi jika metadata atau labelnya
belum diperiksa.

```bash
cat data/datasets/vehicle-person-detector/v358/metadata.json
cat data/datasets/vehicle-person-detector/v358/data.yaml
```

Periksa hal berikut:

- `classMapping` canonical persis `person=0`, `head=1`, `car=2`,
  `motorcycle=3`;
- `imageCount` dan `annotationCount` tidak nol;
- ada split train dan validation;
- tracking session cukup dan satu event tidak bocor ke dua split;
- export benar-benar berasal dari annotation approved.

Jika export baru adalah v359 atau sesudahnya, ganti semua contoh `v358` dengan
versi tersebut secara konsisten.

## 6. Membuat subset crop untuk custom model

Untuk v358, subset sudah tersedia sehingga bagian ini tidak perlu dijalankan
ulang:

```text
data/datasets/vehicle-person-detector/v358-person-head-motorcycle/
```

Untuk export baru, misalnya v359, jalankan:

```bash
python scripts/prepare_training_subset.py \
  data/datasets/vehicle-person-detector/v359 \
  data/datasets/vehicle-person-detector/v359-person-head-motorcycle \
  --classes person head motorcycle \
  --keep-empty
```

`--keep-empty` mempertahankan image yang menjadi kosong setelah class `car`
dikeluarkan. Image tersebut berguna sebagai negative sample untuk custom model,
sementara `car` tetap ditangani YOLO legacy.

Script akan:

- mengecualikan class `car`;
- mengubah motorcycle dari canonical ID `3` menjadi custom ID `2`;
- mempertahankan train/validation split;
- mencatat provenance pada `metadata.json`;
- menolak overwrite output lama.

Periksa hasil v358 yang sudah ada:

```bash
cat data/datasets/vehicle-person-detector/v358-person-head-motorcycle/data.yaml
cat data/datasets/vehicle-person-detector/v358-person-head-motorcycle/metadata.json
```

## 7. Validasi subset tanpa training

Validator yang sama dengan training dapat dipanggil tanpa menjalankan training:

```bash
python -c 'from pathlib import Path; from scripts.train_detector import validate_dataset; print(validate_dataset(Path("data/datasets/vehicle-person-detector/v358-person-head-motorcycle").resolve(), {0: "person", 1: "head", 2: "motorcycle"}))'
```

Validator memeriksa:

- metadata dan `data.yaml` tersedia;
- mapping class sesuai profile custom;
- setiap label memiliki pasangan image;
- koordinat box berada dalam image;
- tidak ada exact duplicate antara train dan validation.

Jangan lanjut bila validator gagal. Perbaiki dataset sumber atau buat versi
turunan baru; jangan menghapus validasi.

## 8. Hentikan realtime CV sebelum training

Pada terminal realtime tekan `Ctrl+C`, lalu periksa:

```bash
ps aux | grep '[p]ython.*-m src.main'
```

Output harus kosong. API dan Dashboard boleh tetap hidup karena tidak memakai
MPS untuk inference CV.

## 9. Alur A — smoke training crop-only

Smoke training hanya memastikan pipeline dapat berjalan. Smoke weight bukan
kandidat deployment.

Karena `detector-v358-phm-smoke-v1` sudah ada, contoh berikut memakai nama baru:

```bash
DATASET_TRAINING_ENABLED=true python scripts/train_detector.py \
  data/datasets/vehicle-person-detector/v358-person-head-motorcycle \
  --base-model models/yolo26n.pt \
  --version detector-v358-phm-smoke-v2 \
  --class-names person head motorcycle \
  --epochs 10 \
  --imgsz 416 \
  --batch 8 \
  --patience 4 \
  --workers 0 \
  --seed 42 \
  --device mps
```

Smoke berhasil bila:

- validator tidak menemukan mapping atau leakage error;
- loss bukan `nan`;
- output `weights/best.pt` dibuat;
- `training-metadata.json` dibuat;
- jumlah completed epoch masuk akal.

## 10. Alur A — main training crop-only

Gunakan nama baru karena folder live v1 sudah ada:

```bash
DATASET_TRAINING_ENABLED=true python scripts/train_detector.py \
  data/datasets/vehicle-person-detector/v358-person-head-motorcycle \
  --base-model models/yolo26n.pt \
  --version detector-v358-phm-live-v2 \
  --class-names person head motorcycle \
  --epochs 60 \
  --imgsz 640 \
  --batch 8 \
  --patience 12 \
  --workers 0 \
  --seed 42 \
  --device mps
```

Jika terjadi kehabisan memori, buat versi baru dan ubah hanya batch:

```text
--batch 4
```

Jangan melanjutkan run gagal dengan nama yang sama. Gunakan versi baru agar
artifact dan provenance tidak bercampur.

Output utama:

```text
data/training-runs/detector-v358-phm-live-v2/
├── weights/best.pt
├── weights/last.pt
├── results.csv
├── args.yaml
└── training-metadata.json
```

Gunakan `best.pt`, bukan `last.pt`.

## 11. Evaluasi model crop-only

```bash
python scripts/evaluate_detector.py \
  --model data/training-runs/detector-v358-phm-live-v2/weights/best.pt \
  --data data/datasets/vehicle-person-detector/v358-person-head-motorcycle/data.yaml \
  --device mps
```

Laporan tersimpan sebagai:

```text
data/training-runs/detector-v358-phm-live-v2/weights/best.evaluation.json
```

Periksa overall dan per-class:

- precision;
- recall;
- mAP50;
- mAP50-95;
- person;
- head;
- motorcycle.

Catat hasil ini sebagai baseline crop-only. Jangan menilai kemampuan full-frame
hanya dari validation crop.

## 12. Memahami full-frame yang tersedia

Workspace annotation:

```text
data/full-frame-assets/all-frame-conditions-labeled-v1/
```

Dataset canonical:

```text
data/datasets/full-frame-conditions-v1/
```

Dataset custom yang siap merge:

```text
data/datasets/full-frame-conditions-v1-person-head-motorcycle/
```

Dataset canonical mempertahankan class `car` untuk provenance. Subset custom
mengeluarkan `car` dan mempertahankan car-only image sebagai negative sample.

Jangan mencampur raw image langsung ke folder v358. Gunakan tool merge agar
mapping, filename, duplicate check, dan metadata tetap benar.

## 13. Alur B — merge v358 crop dengan full-frame

Perintah berikut belum perlu dijalankan saat membaca dokumen. Saat siap membuat
dataset kandidat, jalankan:

```bash
python scripts/merge_training_datasets.py \
  data/datasets/v358-plus-full-frame-phm-v1 \
  --source data/datasets/vehicle-person-detector/v358-person-head-motorcycle \
  --source data/datasets/full-frame-conditions-v1-person-head-motorcycle
```

Perkiraan hasil berdasarkan metadata saat ini:

| Isi | Perkiraan |
| --- | ---: |
| Total image | 452 |
| Total annotation | 973 |
| Negative image | 54 |
| Train image | 309 |
| Validation image | 143 |

Merge akan berhenti jika menemukan mapping berbeda atau exact duplicate. Jangan
menonaktifkan pemeriksaan tersebut.

Periksa output:

```bash
cat data/datasets/v358-plus-full-frame-phm-v1/data.yaml
cat data/datasets/v358-plus-full-frame-phm-v1/metadata.json
find data/datasets/v358-plus-full-frame-phm-v1/images/train -type f | wc -l
find data/datasets/v358-plus-full-frame-phm-v1/images/val -type f | wc -l
find data/datasets/v358-plus-full-frame-phm-v1/labels/train -type f | wc -l
find data/datasets/v358-plus-full-frame-phm-v1/labels/val -type f | wc -l
```

Jumlah image dan label dalam masing-masing split harus sama.

## 14. Validasi dataset merge tanpa training

```bash
python -c 'from pathlib import Path; from scripts.train_detector import validate_dataset; print(validate_dataset(Path("data/datasets/v358-plus-full-frame-phm-v1").resolve(), {0: "person", 1: "head", 2: "motorcycle"}))'
```

Mapping wajib tetap:

```text
0 person
1 head
2 motorcycle
```

## 15. Alur B — smoke training crop + full-frame

```bash
DATASET_TRAINING_ENABLED=true python scripts/train_detector.py \
  data/datasets/v358-plus-full-frame-phm-v1 \
  --base-model models/yolo26n.pt \
  --version detector-v358-full-frame-phm-smoke-v1 \
  --class-names person head motorcycle \
  --epochs 8 \
  --imgsz 416 \
  --batch 8 \
  --patience 4 \
  --workers 0 \
  --seed 42 \
  --device mps
```

Periksa kriteria smoke yang sama dengan crop-only.

## 16. Alur B — main training crop + full-frame

Untuk perbandingan yang adil dengan crop-only, mulai keduanya dari
`models/yolo26n.pt`, seed yang sama, image size yang sama, dan device yang sama:

```bash
DATASET_TRAINING_ENABLED=true python scripts/train_detector.py \
  data/datasets/v358-plus-full-frame-phm-v1 \
  --base-model models/yolo26n.pt \
  --version detector-v358-full-frame-phm-hybrid-v1 \
  --class-names person head motorcycle \
  --epochs 80 \
  --imgsz 640 \
  --batch 8 \
  --patience 15 \
  --workers 0 \
  --seed 42 \
  --device mps
```

Mengapa mulai lagi dari YOLO base?

- crop-only dan merged menjadi dua eksperimen yang dapat dibandingkan;
- hasil tidak dipengaruhi urutan fine-tuning;
- risiko model terlalu melekat pada crop sebelum melihat full-frame berkurang.

## 17. Opsi lanjutan — melanjutkan model crop dengan dataset merge

Ini bukan baseline utama, tetapi boleh menjadi eksperimen terpisah setelah alur
A dan B selesai. Base model dapat berupa best weight crop-only karena mapping
class-nya sama:

```bash
DATASET_TRAINING_ENABLED=true python scripts/train_detector.py \
  data/datasets/v358-plus-full-frame-phm-v1 \
  --base-model data/training-runs/detector-v358-phm-live-v2/weights/best.pt \
  --version detector-v358-full-frame-phm-finetune-v1 \
  --class-names person head motorcycle \
  --epochs 30 \
  --imgsz 640 \
  --batch 8 \
  --patience 8 \
  --workers 0 \
  --seed 42 \
  --device mps
```

Tetap gunakan dataset gabungan, bukan full-frame saja. Fine-tuning hanya dengan
full-frame dapat menurunkan kemampuan pada crop lama. Bandingkan eksperimen ini
dengan kandidat merged yang mulai dari YOLO base; jangan otomatis menganggap
warm-start lebih baik.

## 18. Evaluasi model crop + full-frame

```bash
python scripts/evaluate_detector.py \
  --model data/training-runs/detector-v358-full-frame-phm-hybrid-v1/weights/best.pt \
  --data data/datasets/v358-plus-full-frame-phm-v1/data.yaml \
  --device mps
```

Laporan akan dibuat di:

```text
data/training-runs/detector-v358-full-frame-phm-hybrid-v1/weights/best.evaluation.json
```

Bandingkan minimal:

| Kandidat | Validation yang digunakan |
| --- | --- |
| Crop-only | v358 PHM validation |
| Crop + full-frame | merged validation |
| Fine-tune opsional | merged validation |

Untuk perbandingan tambahan yang adil, evaluasi kandidat crop-only dan merged
pada `data.yaml` validation yang sama. Contoh menguji crop-only pada validation
merged:

```bash
python scripts/evaluate_detector.py \
  --model data/training-runs/detector-v358-phm-live-v2/weights/best.pt \
  --data data/datasets/v358-plus-full-frame-phm-v1/data.yaml \
  --device mps
```

Perintah evaluasi menulis `best.evaluation.json` di samping model. Jika satu
model dievaluasi pada beberapa dataset, salin/rename laporan setelah setiap
evaluasi agar laporan sebelumnya tidak tertimpa.

## 19. Regression full-frame independen

Dataset `full-frame-conditions-v1` saat ini mempunyai:

```text
regressionImageCount: 0
regressionFrozen: false
```

Artinya 137 frame saat ini sudah dipakai untuk train/validation dan tidak boleh
diklaim sebagai regression independen. Script berikut belum dapat dipakai pada
dataset tersebut karena tidak ada `images/regression`:

```text
scripts/evaluate_hybrid_regression.py
```

Sebelum keputusan produksi final, kumpulkan 40–80 frame baru dari sesi yang
tidak overlap dengan training. Target awal:

- 10–20 kosong;
- 10–20 berisi person;
- 10–20 berisi motorcycle;
- kedua lens;
- siang dan malam;
- pagar, tanaman, hewan, bayangan, hujan, dan refleksi sebagai hard-negative.

Setelah manifest regression terpisah tersedia dan diproses oleh
`prepare_full_frame_dataset.py`, jalankan:

```bash
python scripts/evaluate_hybrid_regression.py \
  data/datasets/full-frame-regression-v1 \
  --legacy-model models/yolo26n.pt \
  --custom-model data/training-runs/detector-v358-full-frame-phm-hybrid-v1/weights/best.pt \
  --confidence 0.25 \
  --iou 0.50 \
  --match-iou 0.50 \
  --imgsz 640 \
  --device mps
```

Periksa person/motorcycle recall, false positive empty frame, kewajaran head,
dan car dari legacy YOLO.

## 20. Visual review sebelum runtime

Gunakan image validation atau regression independen, bukan image train:

```bash
yolo predict \
  model=data/training-runs/detector-v358-full-frame-phm-hybrid-v1/weights/best.pt \
  source=data/datasets/v358-plus-full-frame-phm-v1/images/val \
  conf=0.25 \
  iou=0.50 \
  imgsz=640 \
  device=mps \
  project=data/prediction-reviews \
  name=detector-v358-full-frame-phm-hybrid-v1
```

Review terutama:

- tembok atau pagar menjadi person;
- gerobak atau sepeda menjadi motorcycle;
- mobil menjadi person/motorcycle;
- tanaman dan bayangan menghasilkan box besar;
- motorcycle jauh terlewat;
- person lama masih ditemukan;
- head berada di kepala dan tidak terlalu besar.

## 21. Gate pemilihan kandidat

Kandidat tidak cukup hanya memiliki mAP lebih tinggi. Gunakan gate berikut:

| Pemeriksaan | Gate awal |
| --- | --- |
| Mapping class | Persis person=0, head=1, motorcycle=2 |
| Dataset validation | Tidak ada leakage atau label invalid |
| Person recall | Tidak turun lebih dari 0.02 dari kandidat yang disetujui |
| Motorcycle recall | Tidak turun; idealnya meningkat |
| Empty-frame false positive | Tidak lebih buruk dari baseline |
| Head | Box masuk akal pada kepala |
| Car | Tetap stabil karena berasal dari YOLO legacy |
| Performa live | FPS, latency, suhu, dan queue tetap aman |

Jika precision naik tetapi recall motorcycle jatuh, jangan langsung approve.
Jika crop metric bagus tetapi full-frame menghasilkan background box, jangan
deploy.

## 22. Alur C — konfigurasi runtime hybrid

Lakukan hanya setelah kandidat lolos evaluasi dan visual review. Edit `cv/.env`:

```dotenv
MODEL_PATH=yolo26n.pt
EXPERIMENTAL_HYBRID_DETECTOR_ENABLED=true
CUSTOM_DETECTOR_MODEL_PATH=data/training-runs/detector-v358-full-frame-phm-hybrid-v1/weights/best.pt
DEVICE=mps
CONFIDENCE_THRESHOLD=0.25
IOU_THRESHOLD=0.50
IMAGE_SIZE=640
```

Penjelasan:

- `CUSTOM_DETECTOR_MODEL_PATH` menyediakan person/head/motorcycle;
- `MODEL_PATH=yolo26n.pt` menyediakan car;
- threshold runtime sebaiknya sama dengan threshold regression;
- mengubah threshold setelah regression berarti acceptance test harus diulang.

Validasi konfigurasi tanpa memulai worker:

```bash
python -c 'from src.config import Settings; s=Settings(); print({"hybrid": s.EXPERIMENTAL_HYBRID_DETECTOR_ENABLED, "custom": str(s.custom_detector_model_path), "legacy_car": str(s.model_path), "confidence": s.CONFIDENCE_THRESHOLD, "iou": s.IOU_THRESHOLD, "image_size": s.IMAGE_SIZE})'
```

Pastikan custom path menunjuk `best.pt`, bukan `last.pt`.

## 23. Canary live dua lens

Mulai CV:

```bash
python -m src.main
```

Startup hybrid yang benar menampilkan:

```text
Model           : custom=best.pt (person, head, motorcycle); legacy=yolo26n.pt (car)
Object Classes  : person, head, motorcycle, car
Runtime         : headless
```

Pastikan hanya satu worker:

```bash
ps aux | grep '[p]ython.*-m src.main'
```

Checklist pada kedua lens:

1. Background kosong beberapa menit.
2. Person dekat dan jauh.
3. Person IN dan OUT melewati counting line.
4. Anak kecil dan person tertutup sebagian.
5. Motorcycle diam dan bergerak.
6. Motorcycle dengan dan tanpa pengendara.
7. Car tetap mendapat box dari YOLO legacy.
8. Gerobak, pagar, tanaman, hewan, dan refleksi tidak menjadi objek palsu.
9. Head box berada pada kepala.
10. FPS, inference latency, suhu, dan pending queue tetap aman.

Mode hybrid melakukan dua inference pass untuk setiap frame, sehingga latency
lebih tinggi daripada satu model.

## 24. Rollback

Jika kandidat menghasilkan false positive, miss, atau performa buruk, hentikan
CV dan ubah:

```dotenv
EXPERIMENTAL_HYBRID_DETECTOR_ENABLED=false
MODEL_PATH=yolo26n.pt
```

Restart:

```bash
python -m src.main
```

Rollback tidak perlu menghapus custom model. Simpan artifact untuk audit dan
perbandingan selanjutnya.

## 25. Penamaan versi yang disarankan

Gunakan pola yang menyebut sumber dataset dan tujuan:

```text
detector-v358-phm-smoke-v2
detector-v358-phm-live-v2
detector-v358-full-frame-phm-smoke-v1
detector-v358-full-frame-phm-hybrid-v1
detector-v358-full-frame-phm-finetune-v1
```

Untuk export selanjutnya:

```text
v359-person-head-motorcycle
v359-plus-full-frame-phm-v1
detector-v359-full-frame-phm-hybrid-v1
```

Nama dataset dan nama model tidak boleh menyiratkan sumber yang berbeda. Model
yang dilatih dari v358 tidak boleh diberi nama v359.

## 26. Troubleshooting singkat

### Output dataset sudah ada

Script preparation sengaja tidak overwrite. Gunakan nama versi baru. Jangan
menghapus dataset lama sebelum provenance dan pemakaiannya diperiksa.

### Mapping class berbeda

Pastikan kedua source merge memakai mapping custom yang sama:

```text
0 person
1 head
2 motorcycle
```

Jangan merge raw v358 canonical langsung dengan subset full-frame custom.

### Training menolak karena disabled

Training memang opt-in. Prefix perintah harus berisi:

```text
DATASET_TRAINING_ENABLED=true
```

### MPS out of memory

Hentikan realtime CV, gunakan `--workers 0`, lalu turunkan batch dari 8 menjadi
4. Buat run version baru.

### `training-metadata.json` tidak ada

Anggap run belum lengkap atau gagal. Jangan deploy hanya karena `best.pt`
terlihat ada.

### Car hilang pada hybrid

Periksa:

```dotenv
MODEL_PATH=yolo26n.pt
EXPERIMENTAL_HYBRID_DETECTOR_ENABLED=true
```

Custom model tidak menjadi sumber car pada mode hybrid.

### `evaluate_hybrid_regression.py` mengatakan regression image kosong

Dataset full-frame saat ini memang belum mempunyai regression independen.
Kumpulkan sesi terpisah dan jangan memindahkan validation training menjadi
regression.

## 27. Checklist akhir sebelum training dijalankan

- [ ] Export crop terbaru sudah approved dan metadata diperiksa.
- [ ] Subset custom memiliki mapping 0/1/2 yang benar.
- [ ] Full-frame labels sudah direview.
- [ ] Dataset merge memakai output version baru.
- [ ] Exact train/validation leakage check lulus.
- [ ] Realtime CV sudah dihentikan.
- [ ] Smoke menggunakan version name baru.
- [ ] Main run menggunakan version name baru.
- [ ] `best.pt` dan `training-metadata.json` tersedia.
- [ ] Evaluasi crop dan merged dicatat terpisah.
- [ ] Regression independen tersedia sebelum keputusan produksi final.
- [ ] Visual review dan canary dilakukan pada kedua lens.
- [ ] Rollback sudah disiapkan.

## 28. Ringkasan keputusan yang direkomendasikan

Untuk kondisi repository sekarang:

1. Gunakan v358 sebagai crop baseline terbaru.
2. Jangan mengulang subset v358 yang sudah ada.
3. Buat merge baru `v358-plus-full-frame-phm-v1`; jangan memakai nama v358 pada
   merge lama yang berbasis v298.
4. Train crop-only dan merged dari `models/yolo26n.pt` sebagai dua kandidat
   terpisah.
5. Pilih kandidat berdasarkan validation yang sama, full-frame review, dan
   regression independen.
6. Saat deployment, pertahankan `yolo26n.pt` sebagai sumber car dan gunakan
   custom `best.pt` hanya untuk person/head/motorcycle.
7. Jangan menjalankan training sampai operator memang memilih untuk memulai.

## 29. Template reusable untuk dataset baru di kemudian hari

Bagian ini adalah prosedur yang diulang setiap kali ada gambar baru. v358 tetap
menjadi contoh kondisi saat ini, tetapi alurnya tidak bergantung pada v358.

### 29.1 Prinsip versioning

Jangan menambah atau mengganti file di dalam dataset yang sudah pernah dipakai
training. Buat versi baru untuk setiap perubahan material:

```text
crop export baru                 -> v359
crop subset baru                 -> v359-person-head-motorcycle
batch full-frame baru            -> full-frame-conditions-v2
subset full-frame baru           -> full-frame-conditions-v2-person-head-motorcycle
merge baru                       -> v359-plus-full-frame-phm-v2
model baru                       -> detector-v359-full-frame-phm-hybrid-v1
```

Dengan pola ini, model lama selalu dapat direproduksi dan di-rollback.

### 29.2 Jika hanya ada crop baru

Misalnya Dashboard menghasilkan export v359:

```bash
cd /Users/ugiispoyowidodo/Data/pribadi/cv/cctv-detection/cv
source .venv/bin/activate

cat data/datasets/vehicle-person-detector/v359/metadata.json

python scripts/prepare_training_subset.py \
  data/datasets/vehicle-person-detector/v359 \
  data/datasets/vehicle-person-detector/v359-person-head-motorcycle \
  --classes person head motorcycle \
  --keep-empty
```

Validasi:

```bash
python -c 'from pathlib import Path; from scripts.train_detector import validate_dataset; print(validate_dataset(Path("data/datasets/vehicle-person-detector/v359-person-head-motorcycle").resolve(), {0: "person", 1: "head", 2: "motorcycle"}))'
```

Jalankan smoke dan main training dengan nama v359 baru. Jangan merge v358 dan
v359 crop export jika v359 adalah export kumulatif yang sudah memuat gambar
lama. Hal itu akan menduplikasi gambar dan memberi bobot berlebihan pada sample
lama. Untuk crop, gunakan hanya export terbaru yang lengkap.

### 29.3 Jika hanya ada full-frame baru

Simpan source dan label dalam workspace versioned baru, misalnya:

```text
data/full-frame-assets/all-frame-conditions-labeled-v2/
├── labels/
├── manifest.json
├── annotation-report.json
└── README.md
```

Manifest canonical tetap memakai:

```text
0 person
1 head
2 car
3 motorcycle
```

Setiap item manifest harus mencatat:

- image;
- label;
- lens;
- lighting;
- scene;
- usage;
- group.

Frame berurutan dari kejadian yang sama wajib memakai `group` yang sama agar
tidak terpisah antara train dan validation. Frame tanpa objek target harus
memiliki file label kosong, bukan kehilangan file label.

Buat dataset canonical baru:

```bash
python scripts/prepare_full_frame_dataset.py \
  data/full-frame-assets/all-frame-conditions-labeled-v2/manifest.json \
  data/datasets/full-frame-conditions-v2
```

Buat subset custom dan pertahankan negative image:

```bash
python scripts/prepare_training_subset.py \
  data/datasets/full-frame-conditions-v2 \
  data/datasets/full-frame-conditions-v2-person-head-motorcycle \
  --classes person head motorcycle \
  --keep-empty
```

Jangan memasukkan regression independen ke subset training. Item manifest
dengan `usage=regression` tetap berada di dataset canonical dan tidak disalin
oleh `prepare_training_subset.py`.

### 29.4 Jika crop dan full-frame sama-sama bertambah

Gunakan satu crop export terbaru dan seluruh batch full-frame training yang
masih relevan. Ada dua pilihan yang aman:

1. buat full-frame cumulative v2 yang sudah memuat v1 + gambar baru; atau
2. pertahankan full-frame v1 dan v2 sebagai source terpisah saat merge.

Contoh pilihan kedua:

```bash
python scripts/merge_training_datasets.py \
  data/datasets/v359-plus-full-frame-phm-v2 \
  --source data/datasets/vehicle-person-detector/v359-person-head-motorcycle \
  --source data/datasets/full-frame-conditions-v1-person-head-motorcycle \
  --source data/datasets/full-frame-conditions-v2-person-head-motorcycle
```

Tool merge akan menolak exact duplicate. Jika duplicate ditemukan, tentukan
source mana yang menjadi pemilik image tersebut; jangan mengubah isi gambar
hanya untuk melewati duplicate check.

Jangan memasukkan full-frame v1 dua kali melalui dataset cumulative v2 sekaligus
source v1 terpisah.

### 29.5 Template nama yang dapat diganti

Sebelum mulai, tentukan empat nilai berikut:

```text
CROP_VERSION      = v359
FULL_VERSION      = full-frame-conditions-v2
MERGED_VERSION    = v359-plus-full-frame-phm-v2
MODEL_VERSION     = detector-v359-full-frame-phm-hybrid-v1
```

Kemudian pastikan nama tersebut konsisten pada:

- folder input;
- folder output;
- `metadata.json`;
- perintah training;
- perintah evaluasi;
- `CUSTOM_DETECTOR_MODEL_PATH`;
- catatan acceptance test.

### 29.6 Memilih base model untuk training berikutnya

Ada dua strategi yang valid, tetapi hasilnya harus dicatat sebagai eksperimen
berbeda:

| Strategi | `--base-model` | Kapan digunakan |
| --- | --- | --- |
| Baseline reproducible | `models/yolo26n.pt` | Default untuk membandingkan pengaruh dataset |
| Continued fine-tuning | custom `best.pt` yang sudah disetujui | Eksperimen lanjutan dengan mapping class sama |

Gunakan YOLO base jika ingin mengetahui apakah dataset baru memang memperbaiki
hasil. Gunakan previous custom model hanya bila sengaja ingin melanjutkan
fine-tuning. Untuk continued fine-tuning, dataset tetap harus memuat data lama
yang ingin dipertahankan; jangan melatih hanya pada beberapa gambar baru.

### 29.7 Template training generik

Setelah dataset terbaru dibuat dan divalidasi, bentuk perintahnya selalu sama:

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

Selalu jalankan smoke version terlebih dahulu dengan epoch dan image size lebih
kecil. Main training harus memakai nama folder baru.

### 29.8 Template evaluasi generik

```bash
python scripts/evaluate_detector.py \
  --model data/training-runs/detector-v359-full-frame-phm-hybrid-v1/weights/best.pt \
  --data data/datasets/v359-plus-full-frame-phm-v2/data.yaml \
  --device mps
```

Bandingkan kandidat baru dengan model aktif pada regression set yang sama dan
threshold yang sama.

### 29.9 Memasang model baru ke hybrid YOLO

Arsitektur runtime tidak berubah saat dataset/model bertambah. Yang berubah
hanya path custom model:

```dotenv
MODEL_PATH=yolo26n.pt
EXPERIMENTAL_HYBRID_DETECTOR_ENABLED=true
CUSTOM_DETECTOR_MODEL_PATH=data/training-runs/detector-v359-full-frame-phm-hybrid-v1/weights/best.pt
```

`yolo26n.pt` tetap sumber `car`. Custom model terbaru tetap wajib memiliki
mapping `person=0`, `head=1`, `motorcycle=2`. Ulangi validasi konfigurasi,
regression, visual review, dan canary dua lens setiap kali custom path diganti.

### 29.10 Siklus perbaikan berikutnya

Jika canary menemukan kegagalan:

1. simpan frame gagal sebagai kandidat data baru;
2. beri label semua objek target pada frame, bukan hanya objek yang gagal;
3. tambahkan background kosong yang mirip jika masalahnya false positive;
4. buat dataset version baru;
5. merge dengan data lama yang relevan;
6. train dengan model version baru;
7. evaluasi pada regression lama tanpa mengubahnya;
8. tambahkan regression baru hanya sebagai version regression berikutnya;
9. deploy melalui canary dan siapkan rollback.

Dengan siklus ini, crop, full-frame, gabungan dataset, dan runtime hybrid YOLO
dapat terus diperbarui tanpa kehilangan provenance versi sebelumnya.
