# Manual YOLO training and Live Monitoring deployment

Panduan ini menjelaskan alur manual yang aman untuk melatih detector
`person`, `head`, dan `motorcycle`, lalu menggunakannya pada Live Monitoring.
Class `car` tetap berasal dari model lama `models/yolo26n.pt`.

Training ini hanya untuk deteksi objek. Nama resident, alamat, dan hasil Person
Labeling tidak menjadi class YOLO dan tidak membuat model mengenali identitas.

## 1. Arsitektur model yang digunakan

Mode hybrid menjalankan dua detector pada frame RTSP yang sama:

```text
Frame RTSP yang sudah ada
├── custom best.pt  -> person, head, motorcycle
└── yolo26n.pt lama -> car
```

Tidak ada RTSP reader tambahan. Head tidak ikut counting. Counting tetap hanya
untuk `person`, `car`, dan `motorcycle`.

## 2. Persiapan terminal dan service

Project root:

```bash
cd /Users/ugiispoyowidodo/Data/pribadi/cv/cctv-detection
```

Jalankan API dan Dashboard pada terminal terpisah bila belum aktif:

```bash
cd platform
npm run dev:api
```

```bash
cd platform
npm run dev:dashboard
```

Siapkan terminal CV:

```bash
cd /Users/ugiispoyowidodo/Data/pribadi/cv/cctv-detection/cv
source .venv/bin/activate
python -c "import torch; print('MPS available:', torch.backends.mps.is_available())"
```

Pada MacBook M4 hasilnya harus `MPS available: True`. Jangan menjalankan
training bersamaan dengan realtime CV karena keduanya memakai Apple MPS.

## 3. Membuat annotation di Dashboard

1. Buka `http://localhost:5173`.
2. Masuk ke halaman **Person Labeling**.
3. Masukkan operator token pada **Protected operator access**.
4. Buka detail capture.
5. Buka bagian **Detection dataset annotation**.
6. Pilih sumber gambar `full-body` atau `head`.
7. Pilih class `person`, `head`, atau `motorcycle`.
8. Gambar bounding box sedekat mungkin dengan objek.
9. Klik **Add draft annotation**.
10. Periksa kembali box lalu klik **Approve**.

Satu gambar boleh memiliki beberapa annotation. Contoh pada sebuah full-body
image yang juga memperlihatkan motor:

```text
box 1 -> person      (seluruh tubuh yang terlihat)
box 2 -> head        (kepala orang tersebut)
box 3 -> motorcycle  (seluruh motor yang terlihat)
```

Pedoman box:

- Jangan membuat box person memenuhi seluruh gambar jika tubuh hanya memakai
  sebagian area.
- Box head hanya mengelilingi kepala, bukan seluruh upper body.
- Box motorcycle mengelilingi motor, bukan motor beserta seluruh background.
- Jangan approve box tebakan jika objek tertutup dan batasnya tidak jelas.
- Tambahkan variasi kedua lens, IN/OUT, siang/malam, orang jauh, anak kecil,
  occlusion, dan motor dengan/tanpa pengendara.
- Hindari banyak frame berurutan yang hampir identik.

Person Labeling dengan nama resident adalah proses terpisah. Nama resident tidak
boleh dimasukkan ke annotation detection.

## 4. Export dataset

Setelah semua draft yang benar berstatus approved, klik:

```text
Export approved dataset
```

Dashboard akan menampilkan versi, misalnya `v257`. Hasil export berada di:

```text
cv/data/datasets/vehicle-person-detector/v257/
```

Periksa isinya:

```bash
cd /Users/ugiispoyowidodo/Data/pribadi/cv/cctv-detection/cv
ls data/datasets/vehicle-person-detector/v257
cat data/datasets/vehicle-person-detector/v257/metadata.json
cat data/datasets/vehicle-person-detector/v257/data.yaml
```

Ganti `v257` pada semua contoh berikut dengan versi export yang benar. Jangan
memilih folder turunan seperti `v256-person-head-motorcycle` sebagai sumber.

## 5. Buat subset tanpa car

Model custom harus memiliki mapping yang berurutan:

```text
0 person
1 head
2 motorcycle
```

Buat subset baru:

```bash
python scripts/prepare_training_subset.py \
  data/datasets/vehicle-person-detector/v257 \
  data/datasets/vehicle-person-detector/v257-person-head-motorcycle \
  --classes person head motorcycle
```

Script akan:

- mengecualikan annotation car;
- remap motorcycle dari class export `3` menjadi class custom `2`;
- menyalin train/validation split tanpa mengubah export asli;
- menyimpan metadata provenance;
- memberi permission terbatas pada dataset turunan.

Periksa hasil:

```bash
cat data/datasets/vehicle-person-detector/v257-person-head-motorcycle/data.yaml
cat data/datasets/vehicle-person-detector/v257-person-head-motorcycle/metadata.json
```

Nama folder output harus baru. Script sengaja menolak overwrite dataset lama.

## 6. Hentikan CV realtime sebelum training

Pada terminal yang menjalankan `python -m src.main`, tekan:

```text
Ctrl+C
```

Pastikan tidak ada worker tersisa:

```bash
ps aux | grep '[p]ython.*-m src.main'
```

Jangan lanjut jika ada dua worker. Dua worker menyebabkan dua koneksi RTSP,
tracker terpisah, dan konflik preview publisher.

## 7. Training percobaan cepat

Gunakan ini hanya untuk memeriksa apakah dataset dan class mapping valid:

```bash
DATASET_TRAINING_ENABLED=true python scripts/train_detector.py \
  data/datasets/vehicle-person-detector/v257-person-head-motorcycle \
  --base-model models/yolo26n.pt \
  --version detector-v257-phm-smoke-v1 \
  --class-names person head motorcycle \
  --epochs 10 \
  --imgsz 416 \
  --batch 8 \
  --patience 4 \
  --workers 0 \
  --seed 42 \
  --device mps
```

## 8. Training utama

Setelah smoke training berhasil, jalankan training resolusi 640:

```bash
DATASET_TRAINING_ENABLED=true python scripts/train_detector.py \
  data/datasets/vehicle-person-detector/v257-person-head-motorcycle \
  --base-model models/yolo26n.pt \
  --version detector-v257-phm-live-v1 \
  --class-names person head motorcycle \
  --epochs 40 \
  --imgsz 640 \
  --batch 8 \
  --patience 10 \
  --workers 0 \
  --seed 42 \
  --device mps
```

Jika memori tidak cukup, ubah hanya:

```text
--batch 4
```

Jangan memakai nama `--version` yang sudah ada. Contoh versi berikutnya:

```text
detector-v257-phm-live-v2
detector-v258-phm-live-v1
```

Output penting:

```text
data/training-runs/detector-v257-phm-live-v1/weights/best.pt
data/training-runs/detector-v257-phm-live-v1/weights/last.pt
data/training-runs/detector-v257-phm-live-v1/training-metadata.json
data/training-runs/detector-v257-phm-live-v1/results.csv
```

Gunakan `best.pt`, bukan `last.pt`.

## 9. Evaluasi kandidat

```bash
python scripts/evaluate_detector.py \
  --model data/training-runs/detector-v257-phm-live-v1/weights/best.pt \
  --data data/datasets/vehicle-person-detector/v257-person-head-motorcycle/data.yaml \
  --device mps
```

Metrik disimpan di:

```text
data/training-runs/detector-v257-phm-live-v1/weights/best.evaluation.json
```

Periksa:

```bash
cat data/training-runs/detector-v257-phm-live-v1/weights/best.evaluation.json
```

Nilai yang harus dibandingkan per class:

- precision;
- recall;
- mAP50;
- mAP50-95;
- person recall;
- head recall;
- motorcycle false positive.

Nilai validation tinggi tidak menjamin hasil full-frame CCTV baik. Dataset yang
didominasi crop dapat mendapat mAP tinggi tetapi membuat box besar pada tembok,
pagar, atau mobil ketika dijalankan live.

## 10. Aktifkan kandidat pada Live Monitoring

Edit `cv/.env`:

```bash
nano .env
```

Atur:

```dotenv
MODEL_PATH=yolo26n.pt
EXPERIMENTAL_HYBRID_DETECTOR_ENABLED=true
CUSTOM_DETECTOR_MODEL_PATH=data/training-runs/detector-v257-phm-live-v1/weights/best.pt
DEVICE=mps
```

`MODEL_PATH` jangan diganti karena path tersebut tetap dipakai sebagai detector
car lama. Validasi konfigurasi sebelum startup:

```bash
python -c 'from src.config import Settings; s=Settings(); print({"hybrid": s.EXPERIMENTAL_HYBRID_DETECTOR_ENABLED, "custom": str(s.custom_detector_model_path), "legacy_car": str(s.model_path)})'
```

## 11. Jalankan Live Monitoring

```bash
python -m src.main
```

Startup hybrid yang benar menampilkan:

```text
Model          : custom=best.pt (person, head, motorcycle); legacy=yolo26n.pt (car)
Object Classes : person, head, motorcycle, car
Runtime        : headless
Dashboard preview: enabled
```

Periksa sekali lagi bahwa hanya satu worker aktif:

```bash
ps aux | grep '[p]ython.*-m src.main'
```

## 12. Checklist uji live

Buka Live Monitoring dalam Grid View dan uji kedua lens:

1. Person dekat dan jauh.
2. Person masuk dan keluar line.
3. Anak kecil.
4. Kepala jelas, kecil, dan tertutup sebagian.
5. Motor diam dan berjalan.
6. Motor dengan dan tanpa pengendara.
7. Mobil untuk memastikan box car lama masih muncul.
8. Background kosong untuk mencari false positive.
9. Tembok, pagar, tanaman, dan bayangan malam.
10. FPS, queue pending, dan upload capture.

Label preview yang diharapkan:

```text
PERSON #trackId confidence
HEAD #trackId confidence
MOTORCYCLE #trackId confidence
CAR #trackId confidence
```

Log sehat antara lain:

```text
Preview publisher connected
RTSP stream connected
queue_pending=0
HTTP/1.1 201 Created
Person capture delivered
```

Waspadai box besar pada background. False positive yang melewati line dapat
membuat counting event palsu dan, untuk person, pending labeling palsu.

## 13. Rollback

Rollback tidak menghapus hasil training. Hentikan CV dengan `Ctrl+C`, ubah:

```dotenv
EXPERIMENTAL_HYBRID_DETECTOR_ENABLED=false
```

Biarkan path kandidat tetap tersimpan, kemudian jalankan ulang:

```bash
python -m src.main
```

Mode rollback kembali memakai `yolo26n.pt` untuk person, car, dan motorcycle.
Head detector untuk crop tetap menggunakan konfigurasi `HEAD_DETECTION_MODEL_PATH`.

Untuk mengaktifkan kandidat lagi, ubah flag menjadi `true` dan restart CV.

## 14. Troubleshooting

### `Output already exists`

Pilih nama dataset atau `--version` baru. Jangan menghapus hasil lama hanya agar
nama dapat dipakai ulang.

### `MPS available: False`

Pastikan memakai `.venv` project ini dan Python/PyTorch Apple Silicon. Untuk
diagnosis sementara gunakan `--device cpu`, tetapi training akan jauh lebih lama.

### `Publisher already active`

Ada dua worker CV. Hentikan keduanya secara normal, pastikan hasil `ps` kosong,
lalu jalankan satu `python -m src.main`.

### Car hilang setelah aktivasi

Pastikan `MODEL_PATH=yolo26n.pt` dan file `models/yolo26n.pt` tersedia. Custom
model tidak menyediakan car.

### Head tidak muncul di live

Periksa apakah dataset memiliki box head yang rapat dan cukup banyak pada
full-body image. Head crop yang tersimpan dan head box realtime adalah dua hal
berbeda. Head crop masih dapat dibuat oleh detector khusus setelah crossing.

### Validation bagus tetapi live buruk

Tambahkan data yang menyerupai full-frame kamera, terutama background negatives,
orang kecil/jauh, kedua lens, siang/malam, dan variasi perspektif. Jangan terus
menambah crop yang hampir identik.

## 15. Ringkasan command

```text
Approve annotation di Dashboard
-> Export approved dataset
-> prepare_training_subset.py
-> hentikan realtime CV
-> train_detector.py
-> evaluate_detector.py
-> edit .env
-> python -m src.main
-> uji kedua lens
-> pertahankan atau rollback
```
