#include <iostream>
#include <vector>
using namespace std;

const int N = 8;  // 棋盘大小和皇后数量

vector<int> queen(N, -1);  // queen[i] = j 表示第 i 行皇后在第 j 列
int solutions = 0;         // 解的数量

// 检查在 (row, col) 位置放置皇后是否安全
bool isSafe(int row, int col) {
    for (int i = 0; i < row; i++) {
        int j = queen[i];
        // 检查同列
        if (j == col) return false;
        // 检查对角线
        if (abs(i - row) == abs(j - col)) return false;
    }
    return true;
}

// 回溯求解
void solve(int row) {
    if (row == N) {
        solutions++;
        cout << "解 " << solutions << ":\n";
        for (int i = 0; i < N; i++) {
            for (int j = 0; j < N; j++) {
                cout << (queen[i] == j ? "Q " : ". ");
            }
            cout << "\n";
        }
        cout << "\n";
        return;
    }

    for (int col = 0; col < N; col++) {
        if (isSafe(row, col)) {
            queen[row] = col;
            solve(row + 1);
            queen[row] = -1;  // 回溯
        }
    }
}

int main() {
    cout << "八皇后问题所有解:\n\n";
    solve(0);
    cout << "共找到 " << solutions << " 个解\n";
    return 0;
}
