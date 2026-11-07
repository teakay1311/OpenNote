/**
 * Seed dữ liệu ban đầu cho OpenNote:
 * - 2 thư mục hệ thống (Ghi chú, Đã xóa gần đây)
 * - 1 thư mục mẫu "Cá nhân"
 * - Ghi chú chào mừng giới thiệu tính năng (nếu DB trống)
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const DEFAULT_FOLDER_ID = "folder-notes-default";
const TRASH_FOLDER_ID = "folder-trash-default";

async function main() {
  // System folders
  await db.folder.upsert({
    where: { id: DEFAULT_FOLDER_ID },
    update: {},
    create: { id: DEFAULT_FOLDER_ID, name: "Ghi chú", isSystem: true },
  });
  await db.folder.upsert({
    where: { id: TRASH_FOLDER_ID },
    update: {},
    create: { id: TRASH_FOLDER_ID, name: "Đã xóa gần đây", isSystem: true },
  });

  // Only seed sample notes when DB is completely empty
  const count = await db.note.count();
  if (count > 0) {
    console.log(`DB đã có ${count} ghi chú, bỏ qua seed mẫu.`);
    return;
  }

  await db.folder.create({
    data: { name: "Cá nhân" },
  });

  await db.note.create({
    data: {
      title: "Chào mừng đến với OpenNote",
      folderId: DEFAULT_FOLDER_ID,
      pinned: true,
      plainText: [
        "Chào mừng đến với OpenNote",
        "Đây là nơi bạn ghi lại mọi ý tưởng.",
        "Danh sách công việc",
        "Mở khóa đầy đủ tính năng",
        "Thử tạo ghi chú mới bằng nút bút vàng ở góc trên",
        "Gõ #thẻ ngay trong nội dung để tạo thẻ — thẻ sẽ xuất hiện ở thanh bên",
        "Định dạng văn bản",
        "Chọn chữ rồi bấm Aa để đổi kiểu tiêu đề, đậm, nghiêng, gạch chân…",
        "Dán ảnh trực tiếp vào ghi chú (Ctrl/⌘ + V) hoặc bấm nút ảnh",
        "Chèn bảng",
        "Cột A",
        "Cột B",
        "Hàng 1",
        "Hàng 2",
        "Mẹo hay",
        "Ghim ghi chú quan trọng để luôn nằm trên cùng",
        "Khóa ghi chú riêng tư bằng mã PIN",
        "Ghi chú đã xóa sẽ nằm trong Đã xóa gần đây trong 30 ngày trước khi bị xóa hẳn",
      ].join("\n"),
      content: `
<h1>Chào mừng đến với OpenNote</h1>
<p>Đây là nơi bạn ghi lại mọi ý tưởng — như ứng dụng Ghi chú của Apple, nhưng của riêng bạn.</p>
<h2>Danh sách công việc</h2>
<ul class="taskList">
<li class="taskItem checked"><span class="taskCb" contenteditable="false"></span>Mở khóa đầy đủ tính năng</li>
<li class="taskItem"><span class="taskCb" contenteditable="false"></span>Thử tạo ghi chú mới bằng nút bút vàng ở góc trên</li>
<li class="taskItem"><span class="taskCb" contenteditable="false"></span>Gõ #thẻ ngay trong nội dung để tạo thẻ — thẻ sẽ xuất hiện ở thanh bên</li>
</ul>
<h2>Định dạng văn bản</h2>
<p>Chọn chữ rồi bấm <b>Aa</b> để đổi kiểu <b>tiêu đề</b>, <i>nghiêng</i>, <u>gạch chân</u>, <s>gạch ngang</s>, màu chữ và nền chữ. Có cả danh sách, trích dẫn và đường kẻ.</p>
<p>Dán ảnh trực tiếp vào ghi chú (Ctrl/⌘ + V) hoặc bấm nút ảnh trên thanh công cụ.</p>
<h2>Chèn bảng</h2>
<table class="noteTable"><tbody>
<tr><td>Cột A</td><td>Cột B</td></tr>
<tr><td>Hàng 1</td><td>Có thể thêm/bớt hàng cột</td></tr>
<tr><td>Hàng 2</td><td>Nhấp vào bảng để hiện thanh điều khiển</td></tr>
</tbody></table>
<blockquote>Mẹo hay: ghim ghi chú quan trọng để luôn nằm trên cùng, hoặc khóa ghi chú riêng tư bằng mã PIN từ menu ⋯.</blockquote>
<p>Ghi chú đã xóa sẽ nằm trong <b>Đã xóa gần đây</b> và có thể khôi phục bất cứ lúc nào.</p>
`,
    },
  });

  await db.note.create({
    data: {
      title: "Sổ tay #côngviệc",
      folderId: DEFAULT_FOLDER_ID,
      plainText: [
        "Sổ tay #côngviệc",
        "Họp nhóm thứ Hai",
        "Chuẩn bị báo cáo tuần",
        "Gửi email cho đối tác",
        "Việc cần làm trong tuần",
        "Duyệt tài liệu thiết kế",
        "Cập nhật lộ trình sản phẩm",
      ].join("\n"),
      content: `
<h1>Sổ tay #côngviệc</h1>
<h2>Họp nhóm thứ Hai</h2>
<ul class="taskList">
<li class="taskItem"><span class="taskCb" contenteditable="false"></span>Chuẩn bị báo cáo tuần</li>
<li class="taskItem"><span class="taskCb" contenteditable="false"></span>Gửi email cho đối tác</li>
</ul>
<h2>Việc cần làm trong tuần</h2>
<ul>
<li>Duyệt tài liệu thiết kế</li>
<li>Cập nhật lộ trình sản phẩm</li>
</ul>
`,
    },
  });

  console.log("Seed xong: 2 thư mục hệ thống + 1 thư mục cá nhân + 2 ghi chú mẫu.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
