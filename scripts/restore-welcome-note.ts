/**
 * Restore lại ghi chú chào mừng bị xóa nhầm trong quá trình test E2E.
 * Nội dung y hệt seed-opennote.ts.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const exists = await db.note.findFirst({
    where: { title: "Chào mừng đến với OpenNote" },
  });
  if (exists) {
    console.log("Ghi chú chào mừng đã tồn tại, không thêm.");
    return;
  }

  await db.note.create({
    data: {
      title: "Chào mừng đến với OpenNote",
      folderId: "folder-notes-default",
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

  console.log("Đã khôi phục ghi chú chào mừng.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
