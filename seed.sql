-- Demo exam modeled on the TSA sample (Đề số 02)
INSERT OR IGNORE INTO exams (id, title, description, duration_minutes, source_pdf_name) VALUES
  (1, 'TSA_CD682 — Đề số 02', 'Đề luyện thi Đánh giá Tư duy (TSA) · Phần Toán học', 60, '[TENSA 2K9] Đề số 02.pdf');

INSERT OR IGNORE INTO sections (id, exam_id, title, position) VALUES
  (1, 1, 'Phần 1 — Tư duy Toán học', 1);

-- Q1 (fill): simple counting
INSERT OR IGNORE INTO questions (id, exam_id, section_id, number, type, body, data, correct_answer, points) VALUES
  (1, 1, 1, 1,
   'fill',
   'Một cửa hàng đồ uống có 5 loại trà, 4 loại sinh tố và 3 loại cà phê (các thức uống đều khác nhau). Bạn Minh muốn chọn đúng một cốc đồ uống để thưởng thức. Số cách chọn của Minh là ___.',
   '{"blanks":1}',
   '12',
   1);

-- Q2 (mcq)
INSERT OR IGNORE INTO questions (id, exam_id, section_id, number, type, body, data, correct_answer, points) VALUES
  (2, 1, 1, 2,
   'mcq',
   'Giá trị của lim(n→+∞) (6n² − n + 1) / (2n² + 3) bằng',
   '{"options":[{"key":"A","text":"6"},{"key":"B","text":"3"},{"key":"C","text":"2"},{"key":"D","text":"5"}]}',
   'B',
   1);

-- Q3 (mcq)
INSERT OR IGNORE INTO questions (id, exam_id, section_id, number, type, body, data, correct_answer, points) VALUES
  (3, 1, 1, 3,
   'mcq',
   'Hệ số của x³ trong khai triển của biểu thức (2x − 1)⁵ là',
   '{"options":[{"key":"A","text":"40"},{"key":"B","text":"-80"},{"key":"C","text":"-40"},{"key":"D","text":"80"}]}',
   'D',
   1);

-- Q14 — the true/false group shown in the screenshot (cylindrical coordinates)
INSERT OR IGNORE INTO questions (id, exam_id, section_id, number, type, body, data, correct_answer, points) VALUES
  (14, 1, 1, 14,
   'tf',
   'Hệ tọa độ trụ là một hệ tọa độ ba chiều mở rộng từ hệ tọa độ cực. Nó được sử dụng để xác định vị trí của một điểm trong không gian bằng cách sử dụng ba tọa độ:\n\n• r (bán kính trụ): Khoảng cách từ hình chiếu của điểm đó trên mặt phẳng xy đến gốc tọa độ. r ≥ 0\n• θ (góc phương vị): Góc giữa tia Ox và tia nối gốc tọa độ với hình chiếu của điểm đó trên mặt phẳng Oxy. 0 ≤ θ < 2π\n• z (cao độ): Khoảng cách từ điểm đó đến mặt phẳng Oxy',
   '{"statements":[{"key":"a","text":"Cho điểm A(3; π/2; 4) chuyển sang hệ trục tọa độ Oxyz có tọa độ là A''(3; 3; 4)"},{"key":"b","text":"Cho điểm B(3; π/3; 4); C(2; π/6; 5). Giá trị của BC² bằng (31 − 12√3)/4"}]}',
   '{"a":false,"b":false}',
   2);
