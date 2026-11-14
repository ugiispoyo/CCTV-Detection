# Hybrid detector baseline (v297)

Baseline ini mempertahankan `yolo26n.pt` untuk class `car` dan memakai model
custom untuk `person`, `head`, dan `motorcycle`. Kedua model membaca frame RTSP
yang sama. Hybrid bukan ensemble voting: output dibagi berdasarkan class agar
tidak ada box person/motorcycle ganda dari dua model.

```text
full frame CCTV
├── detector-v297-phm-hybrid-v1 -> person, head, motorcycle
└── yolo26n.pt                  -> car
```

## Batasan baseline

Export `v297` berisi 314 image, 706 box, dan 39 tracking session. Distribusi box
adalah 298 person, 309 head, dan 99 motorcycle. Dataset ini cocok sebagai sumber
awal custom detector, tetapi mayoritas merupakan crop hasil person capture. Nilai
validation-nya tidak cukup untuk membuktikan akurasi pada full frame CCTV.

Jangan mencampurkan regression frame ke training. Dengan pemisahan tersebut,
pertanyaan “lebih sensitif tetapi apakah false positive bertambah?” tetap dapat
dijawab secara jujur.

## 1. Siapkan subset training v297

Perintah berikut mempertahankan empty label bila nanti export memiliki negative
image dan meremap motorcycle dari ID 3 menjadi ID 2:

```bash
cd cv
.venv/bin/python scripts/prepare_training_subset.py \
  data/datasets/vehicle-person-detector/v297 \
  data/datasets/vehicle-person-detector/v297-person-head-motorcycle \
  --classes person head motorcycle \
  --keep-empty
```

Mapping output wajib:

```text
0 person
1 head
2 motorcycle
```

## 2. Training kandidat custom

`yolo26n.pt` dipakai sebagai pretrained starting weight, bukan ditimpa. Baseline
pertama memakai seed tetap dan output versioned:

```bash
DATASET_TRAINING_ENABLED=true .venv/bin/python scripts/train_detector.py \
  data/datasets/vehicle-person-detector/v297-person-head-motorcycle \
  --base-model models/yolo26n.pt \
  --version detector-v297-phm-hybrid-v1 \
  --class-names person head motorcycle \
  --epochs 60 --imgsz 640 --batch 8 --patience 12 --workers 0 \
  --seed 42 --device mps
```

Evaluasi validation internal:

```bash
.venv/bin/python scripts/evaluate_detector.py \
  --model data/training-runs/detector-v297-phm-hybrid-v1/weights/best.pt \
  --data data/datasets/vehicle-person-detector/v297-person-head-motorcycle/data.yaml \
  --device mps
```

### Hasil kandidat v1 (2026-11-14)

Training berhenti melalui early stopping pada epoch 46. Evaluasi independen pada
108 validation image / 258 box menghasilkan:

| Class | Precision | Recall | mAP50 | mAP50-95 |
| --- | ---: | ---: | ---: | ---: |
| overall | 0.8467 | 0.8160 | 0.8519 | 0.5958 |
| person | 0.9270 | 0.7778 | 0.8469 | 0.6848 |
| head | 0.8151 | 0.7914 | 0.8375 | 0.5322 |
| motorcycle | 0.7980 | 0.8788 | 0.8712 | 0.5705 |

Dibanding kandidat v287, mAP50-95 overall naik dari `0.5886` ke `0.5958`, tetapi
recall overall turun dari `0.8644` ke `0.8160` dan recall motorcycle turun dari
`0.9690` ke `0.8788`. Karena targetnya lebih sensitif sekaligus akurat, kandidat
v1 belum boleh dinyatakan lebih baik atau diaktifkan hanya dari hasil ini. Ia
harus melewati full-frame regression di bagian berikutnya.

## 3. Buat full-frame set terpisah

Mulai dengan 40–80 regression frame yang tidak pernah dipakai training:

- 10–20 frame kosong;
- 10–20 frame berisi person;
- 10–20 frame berisi motorcycle;
- kedua lens;
- kombinasi siang dan malam.

Untuk penambahan full-frame khusus training, ambil sesi lain dan tandai
`"usage": "train"`. Usahakan baseline awal sedikitnya 120–200 training frame
dengan negative/background, person kecil/jauh, motorcycle, occlusion, serta kedua
lens dan kondisi cahaya. Frame berurutan dari satu kejadian harus memakai nilai
`group` yang sama agar tidak bocor antara train dan validation.

Kandidat full-frame asli dapat dikumpulkan dari kedua RTSP tanpa langsung
menetapkan training/regression:

```bash
.venv/bin/python scripts/collect_full_frame_assets.py \
  --output data/full-frame-assets/day-v1 \
  --target-per-lens 10 --interval-seconds 6 --timeout-minutes 15 \
  --custom-model data/training-runs/detector-v297-phm-hybrid-v1/weights/best.pt \
  --legacy-model models/yolo26n.pt --device cpu
```

Kategori hasil kolektor hanya kandidat untuk review. `ambiguous` sengaja
menampung proposal custom yang tidak dikonfirmasi model lama agar false positive
tidak dibuang. Jangan membuat label kosong bila masih ada target nyata di frame.

Salin `config/full-frame-baseline.example.json`, isi path image dan label yang
sudah direview, lalu jalankan:

```bash
.venv/bin/python scripts/prepare_full_frame_dataset.py \
  config/full-frame-baseline.json \
  data/datasets/full-frame-baseline-v1 \
  --enforce-regression-baseline
```

Label memakai mapping canonical export: `0 person`, `1 head`, `2 car`, dan
`3 motorcycle`. Frame kosong wajib mempunyai file `.txt` kosong. Script menolak
duplikat image, box di luar batas, mapping salah, serta group yang menyeberang
training/regression. Item regression disimpan terpisah dan tidak masuk
`data.yaml` training.

Jika full-frame training sudah terkumpul, remap dahulu ke tiga class custom lalu
gabungkan dengan subset v297. Regression split tidak ikut proses ini:

```bash
.venv/bin/python scripts/prepare_training_subset.py \
  data/datasets/full-frame-baseline-v1 \
  data/datasets/full-frame-baseline-v1-phm \
  --classes person head motorcycle --keep-empty

.venv/bin/python scripts/merge_training_datasets.py \
  data/datasets/v297-plus-full-frame-phm-v1 \
  --source data/datasets/vehicle-person-detector/v297-person-head-motorcycle \
  --source data/datasets/full-frame-baseline-v1-phm
```

Train iterasi berikutnya menggunakan dataset gabungan tersebut dan version name
baru, misalnya `detector-v297-full-frame-phm-v2`. Jangan menimpa kandidat v1.

## 4. Regression test legacy vs hybrid

Setelah kandidat selesai, bandingkan YOLO lama dengan output hybrid:

```bash
.venv/bin/python scripts/evaluate_hybrid_regression.py \
  data/datasets/full-frame-baseline-v1 \
  --legacy-model models/yolo26n.pt \
  --custom-model data/training-runs/detector-v297-phm-hybrid-v1/weights/best.pt \
  --confidence 0.25 --iou 0.50 --match-iou 0.50 --device mps
```

Laporan mencatat TP/FP/FN, precision, dan recall per class, serta jumlah
full-frame kosong yang mendapat false positive. Head pada baseline lama tidak
dibandingkan karena model lama tidak memiliki class head.

Kandidat belum layak diaktifkan bila person lama banyak hilang, motorcycle tidak
membaik, atau false positive pada frame kosong/background naik tanpa batas yang
dapat diterima. Simpan laporan JSON kandidat sebagai baseline untuk iterasi
berikutnya; jangan memilih model hanya dari mAP dataset crop.

## 5. Aktivasi hybrid dan rollback

Aktivasi hanya setelah review validation dan full-frame regression:

```dotenv
MODEL_PATH=models/yolo26n.pt
EXPERIMENTAL_HYBRID_DETECTOR_ENABLED=true
CUSTOM_DETECTOR_MODEL_PATH=data/training-runs/detector-v297-phm-hybrid-v1/weights/best.pt
CONFIDENCE_THRESHOLD=0.25
IOU_THRESHOLD=0.50
```

Restart service CV, lalu pantau kedua lens. Karena dua inference pass dijalankan,
periksa juga FPS dan latency. Untuk rollback, ubah hanya:

```dotenv
EXPERIMENTAL_HYBRID_DETECTOR_ENABLED=false
```

Model dan laporan kandidat tidak perlu dihapus.
