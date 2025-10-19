# Pembagi Kelompok Acak — Mode Menegangkan

Aplikasi web sederhana untuk membagi daftar nama menjadi beberapa kelompok secara acak. Pengguna bisa:
- Mengetik daftar nama manual (satu per baris atau dipisah koma)
- Impor dari file `.txt` atau `.csv`
- Memilih jumlah kelompok atau ukuran per kelompok
- Menjalankan pengungkapan nama satu-per-satu dengan efek menegangkan dan musik latar sintetis (tanpa file audio eksternal)
- Mengekspor hasil ke CSV

## Cara Pakai

1. Unduh semua file di folder yang sama:
   - `index.html`
   - `style.css`
   - `script.js`

2. Buka `index.html` di browser modern (Chrome, Edge, Firefox, Safari).

3. Masukkan nama (satu per baris) atau impor file `.txt/.csv`.

4. Pilih mode:
   - "Jumlah kelompok" untuk membagi menjadi `N` kelompok, atau
   - "Ukuran per kelompok" untuk membagi per ukuran tertentu.

5. Atur:
   - Kecepatan pengungkapan
   - Mode menegangkan (efek lampu)
   - Musik latar dan volume

6. Klik "Mulai Pengelompokan" untuk memulai animasi pengungkapan. Gunakan "Jeda/Lanjut" bila perlu.

7. Setelah selesai, Anda bisa "Acak Ulang" atau "Unduh Hasil (CSV)".

## Catatan Teknis

- Musik latar disintesis menggunakan WebAudio API, sehingga tidak butuh file audio pihak ketiga dan aman untuk dipakai offline.
- Jika jumlah kelompok lebih besar dari jumlah nama, beberapa kelompok bisa kosong (aplikasi akan memberi catatan).
- Ekspor CSV membuat file dengan kolom per kelompok, baris-baris diisi nama sesuai urutan pengelompokan.

## Privasi

- Daftar nama dan pengaturan disimpan di `localStorage` browser secara lokal di perangkat Anda.

## Kompatibilitas

- Direkomendasikan browser modern terbaru. Autoplay audio biasanya membutuhkan interaksi pengguna (tombol Mulai sudah memenuhi ini).