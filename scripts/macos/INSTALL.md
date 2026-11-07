# Cài OpenNote trên Mac Apple Silicon

1. Trong Terminal, chuyển vào thư mục chứa bản cài và chạy `shasum -a 256 -c OpenNote-*-macos-arm64.dmg.sha256`.
2. Mở tệp `.dmg` trong Finder. Kéo **OpenNote** sang **Applications**, rồi tháo ổ đĩa ảnh. Bản cài này được ký ad-hoc để dùng trên máy tạo bản cài.
3. Với dữ liệu mới, mở **OpenNote** trong Applications. Với SQLite cũ, hoàn thành bước chuyển dữ liệu bên dưới trước khi mở app. OpenNote mở trình duyệt mặc định tại `http://127.0.0.1:16347`.

## Thử IME và hộp thoại in bằng SQLite giả

1. Chạy trong Terminal để tạo một phiên kiểm thử riêng.

   ```sh
   opennote_test_dir="$(mktemp -d /private/tmp/opennote-manual.XXXXXXXX)"
   /Applications/OpenNote.app/Contents/MacOS/OpenNote --test-data-dir "$opennote_test_dir"
   ```

2. Mở `http://127.0.0.1:16347` trong Chrome. Tạo một ghi chú thử, gõ tiếng Việt bằng bộ gõ hệ điều hành, đợi tự lưu rồi tải lại để đối chiếu. Dùng lệnh in của ghi chú và mở hộp thoại in hệ thống từ phần tùy chọn in của Chrome. Hủy hộp thoại sau khi kiểm tra.
3. Đóng tab kiểm thử và nhấn **Ctrl+C** trong Terminal để dừng phiên. Sau khi các ca đạt, chuyển SQLite cũ theo hướng dẫn bên dưới.

## Chuyển SQLite cũ

1. Lưu và đóng các tab OpenNote cũ, rồi dừng máy chủ cũ.
2. Chạy lệnh sau với đường dẫn tuyệt đối của SQLite nguồn.

   ```sh
   /Applications/OpenNote.app/Contents/MacOS/OpenNote --migrate-from "/đường/dẫn/đến/custom.db"
   ```

3. Mở app khi lệnh báo đã chuyển dữ liệu. Kiểm tra số ghi chú, thư mục và đường dẫn trong **Cài đặt → Lưu trữ**. Dữ liệu nằm tại `~/Library/Application Support/OpenNote/custom.db`. Bản sao trước nâng cấp nằm trong thư mục `Backups` bên cạnh.
4. Nếu đích đã có SQLite hoặc tệp nhật ký, dừng và giữ cả hai bản. Nếu thao tác bị gián đoạn trước khi SQLite đích xuất hiện, chạy lại lệnh sau khi chắc chắn app đã dừng.

## Thay bản app hoặc quay lại bản trước

1. Lưu và đóng các tab, rồi chọn **Thoát OpenNote** ở menu app. Tạo bản sao nhất quán của SQLite hiện hành bằng SQLite `.backup`.
2. Thay `.app` trong Applications. Để chạy standalone đối chứng, kiểm tra nó với bản sao của SQLite hiện hành trước, sau đó dùng `DATABASE_URL` trỏ đến SQLite hiện hành và đặt `HOSTNAME=127.0.0.1 PORT=16347` khi OpenNote đã dừng.
3. Nếu bản đối chứng không tương thích với bản sao, giữ SQLite hiện hành và bản sao của nó để xử lý tiếp. Giữ bản sao trước nâng cấp ở thư mục riêng để bảo toàn các lần ghi mới.
